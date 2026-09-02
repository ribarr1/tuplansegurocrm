import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canAccessPolicy, type PolicyAccessPersons } from "@/services/policies.service";
import { policyIdSchema } from "@/schemas/policy.schema";
import {
  commissionExpectationIdSchema,
  listCommissionExpectationsQuerySchema,
  commissionTotalsQuerySchema,
  createCommissionExpectationSchema,
  updateCommissionExpectationSchema,
  addCommissionPaymentSchema,
} from "@/schemas/commission.schema";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Política de acceso — Comisiones (V1)
//
// FINANCIERO / RESTRINGIDO. A diferencia del resto de módulos, ASSISTANT
// no tiene ningún acceso a este módulo — ni de lectura ni de escritura,
// decisión explícita de negocio (ver docs/DECISIONS.md). Se aplica en
// cada función exportada, no solo en la UI.
//
// ADMIN: acceso completo — crea/edita/cancela expectativas, registra
//   pagos/chargebacks/ajustes, ve todo.
// AGENT: solo lectura, y solo de comisiones ligadas a pólizas donde
//   tiene acceso operativo (misma regla que canAccessPolicy). Nunca
//   crea expectativas, nunca registra movimientos.
// ASSISTANT: FORBIDDEN en toda función de este servicio.
// ---------------------------------------------------------------------------

function assertModuleAccess(actor: AuthorizedUser): void {
  if (actor.role === "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes acceso al módulo de comisiones.");
  }
}

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede realizar esta acción.");
  }
}

const policySummarySelect = {
  id: true,
  policyNumber: true,
  holder: { select: { id: true, firstName: true, lastName: true, assignedAgentId: true } },
  members: { select: { person: { select: { assignedAgentId: true } } } },
  product: {
    select: {
      id: true,
      name: true,
      policyType: true,
      carrier: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PolicySelect;

const paymentSelect = {
  id: true,
  amount: true,
  type: true,
  receivedAt: true,
  externalReference: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.CommissionPaymentSelect;

const expectationSelect = {
  id: true,
  policyId: true,
  agentId: true,
  period: true,
  expectedAmount: true,
  // Fase 019.7 (hallazgo #14) — comparación "calculado vs esperado
  // final" cuando la expectativa vino de una CommissionRule.
  calculatedAmount: true,
  generatedByRuleId: true,
  isManualOverride: true,
  overriddenById: true,
  overriddenAt: true,
  overrideReason: true,
  overriddenBy: { select: { id: true, name: true } },
  status: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, name: true } },
  policy: { select: policySummarySelect },
  payments: { select: paymentSelect, orderBy: { receivedAt: "asc" } },
} satisfies Prisma.CommissionExpectationSelect;

type ExpectationWithPayments = Prisma.CommissionExpectationGetPayload<{
  select: typeof expectationSelect;
}>;

function policyInvolved(policy: {
  holder: { assignedAgentId: string | null };
  members: { person: { assignedAgentId: string | null } }[];
}): PolicyAccessPersons {
  return [policy.holder, ...policy.members.map((m) => m.person)];
}

// Exportada para que export.service.ts (Fase 020) reutilice
// exactamente la misma regla de scoping en la exportación CSV.
export function agentCommissionAccessWhere(actor: AuthorizedUser): Prisma.CommissionExpectationWhereInput | null {
  if (actor.role === "ADMIN") return null;
  return {
    policy: {
      OR: [
        { holder: { assignedAgentId: null } },
        { holder: { assignedAgentId: actor.id } },
        { members: { some: { person: { assignedAgentId: null } } } },
        { members: { some: { person: { assignedAgentId: actor.id } } } },
      ],
    },
  };
}

// Estado derivado — nunca almacenado. Se calcula siempre a partir de
// expectation.status y SUM(payments.amount) con aritmética Decimal
// (Prisma.Decimal), nunca con Number/parseFloat.
export const COMMISSION_DERIVED_STATUS_VALUES = [
  "CANCELLED",
  "ZERO",
  "NO_EXPECTATION",
  "NEGATIVE_BALANCE",
  "PENDING",
  "PARTIAL",
  "PAID",
  "OVERPAID",
] as const;
export type CommissionDerivedStatus = (typeof COMMISSION_DERIVED_STATUS_VALUES)[number];

export function sumPayments(payments: { amount: Prisma.Decimal | string }[]): Prisma.Decimal {
  return payments.reduce(
    (sum: Prisma.Decimal, p) => sum.plus(new Prisma.Decimal(p.amount)),
    new Prisma.Decimal(0)
  );
}

// Pura y exportada para poder probarla de forma determinista (mismo
// patrón que isTaskOverdue/computeNextOccurrence en fases anteriores).
export function computeCommissionStatus(
  expectationStatus: "ACTIVE" | "CANCELLED",
  expectedAmount: Prisma.Decimal | string,
  received: Prisma.Decimal | string
): CommissionDerivedStatus {
  if (expectationStatus === "CANCELLED") return "CANCELLED";

  const expected = new Prisma.Decimal(expectedAmount);
  const receivedDecimal = new Prisma.Decimal(received);

  if (expected.isZero()) {
    return receivedDecimal.isZero() ? "ZERO" : "NO_EXPECTATION";
  }
  if (receivedDecimal.isNegative()) return "NEGATIVE_BALANCE";
  if (receivedDecimal.isZero()) return "PENDING";
  if (receivedDecimal.lessThan(expected)) return "PARTIAL";
  if (receivedDecimal.equals(expected)) return "PAID";
  return "OVERPAID";
}

function attachDerived(expectation: ExpectationWithPayments) {
  const received = sumPayments(expectation.payments);
  const derivedStatus = computeCommissionStatus(
    expectation.status,
    expectation.expectedAmount,
    received
  );
  return {
    ...expectation,
    receivedAmount: received,
    difference: new Prisma.Decimal(expectation.expectedAmount).minus(received),
    derivedStatus,
  };
}

async function assertActiveAgentId(agentId: string): Promise<void> {
  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, role: true, isActive: true },
  });
  if (!agent || !agent.isActive || agent.role !== "AGENT") {
    throw new AppError("VALIDATION_ERROR", "agentId: Selecciona un agente activo válido.");
  }
}

async function loadPolicyForCommissions(policyId: string) {
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: policySummarySelect,
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  return policy;
}

export async function listCommissionExpectations(actor: AuthorizedUser, rawQuery: unknown) {
  assertModuleAccess(actor);
  const { page, pageSize, search, period, agentId, carrierId, status } = parseOrThrow(
    listCommissionExpectationsQuerySchema,
    rawQuery
  );

  const periodFilter = period
    ? (() => {
        const [year, month] = period.split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, 1));
      })()
    : undefined;

  const where: Prisma.CommissionExpectationWhereInput = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(agentId ? { agentId } : {}),
    ...(status ? { status } : {}),
    ...(carrierId ? { policy: { product: { carrierId } } } : {}),
    ...(search
      ? {
          policy: {
            OR: [
              { policyNumber: { contains: search, mode: "insensitive" } },
              { holder: { firstName: { contains: search, mode: "insensitive" } } },
              { holder: { lastName: { contains: search, mode: "insensitive" } } },
            ],
          },
        }
      : {}),
  };

  const agentWhere = agentCommissionAccessWhere(actor);
  const finalWhere: Prisma.CommissionExpectationWhereInput = agentWhere
    ? { AND: [where, agentWhere] }
    : where;

  // Promise.all, no prisma.$transaction([...]) — ver docs/DECISIONS.md
  // ("Advertencia de concurrencia pg", Fase 019.6).
  const [items, total] = await Promise.all([
    prisma.commissionExpectation.findMany({
      where: finalWhere,
      select: expectationSelect,
      orderBy: { period: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.commissionExpectation.count({ where: finalWhere }),
  ]);

  return { items: items.map(attachDerived), total, page, pageSize };
}

// Total agregado esperado/recibido/diferencia de UN período, para TODO
// el alcance autorizado del actor — a diferencia de listCommissionExpectations
// (paginado, pensado para una tabla en pantalla), esta función nunca debe
// truncar: un total financiero que solo sume la primera página sería
// simplemente incorrecto si hay más expectativas que pageSize (ver
// docs/DECISIONS.md, Fase 019 — hardening del Dashboard).
//
// Se agrega en la base de datos (Prisma aggregate), nunca cargando cada
// fila a memoria para sumar con JS — SUM(expectedAmount) y
// SUM(CommissionPayment.amount) son dos consultas de agregación
// separadas (la segunda filtrando por la relación commissionExpectation),
// ambas devuelven Prisma.Decimal, nunca Number.
export async function getCommissionTotalsForPeriod(actor: AuthorizedUser, rawQuery: unknown) {
  assertModuleAccess(actor);
  const { period } = parseOrThrow(commissionTotalsQuerySchema, rawQuery);

  const agentWhere = agentCommissionAccessWhere(actor);
  const expectationWhere: Prisma.CommissionExpectationWhereInput = agentWhere
    ? { AND: [{ period }, agentWhere] }
    : { period };

  const [count, expectedAgg, paymentAgg] = await Promise.all([
    prisma.commissionExpectation.count({ where: expectationWhere }),
    prisma.commissionExpectation.aggregate({
      where: expectationWhere,
      _sum: { expectedAmount: true },
    }),
    prisma.commissionPayment.aggregate({
      where: { commissionExpectation: expectationWhere },
      _sum: { amount: true },
    }),
  ]);

  // Distingue "sin expectativas registradas este período" de
  // "expectedAmount realmente es 0" — count() es la única forma
  // confiable de saberlo, ya que ambos _sum resultarían en 0/null en
  // cualquier caso cuando no hay filas.
  if (count === 0) {
    return { hasData: false as const, period };
  }

  const expected = new Prisma.Decimal(expectedAgg._sum.expectedAmount ?? 0);
  const received = new Prisma.Decimal(paymentAgg._sum.amount ?? 0);

  return {
    hasData: true as const,
    period,
    expected,
    received,
    difference: expected.minus(received),
  };
}

export async function getCommissionExpectationById(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  const id = parseOrThrow(commissionExpectationIdSchema, rawId);
  const expectation = await prisma.commissionExpectation.findUnique({
    where: { id },
    select: expectationSelect,
  });
  if (!expectation) throw new AppError("NOT_FOUND", "Comisión no encontrada.");
  if (!canAccessPolicy(actor, policyInvolved(expectation.policy))) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta comisión.");
  }
  return attachDerived(expectation);
}

// Todas las expectativas de una Policy — usado por commissions-section.tsx
// en Policy Detail. Llamada explícita y separada de getPolicyById (nunca
// se agregan comisiones al select de Policy — minimización de datos).
export async function getCommissionsForPolicy(actor: AuthorizedUser, rawPolicyId: unknown) {
  assertModuleAccess(actor);
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await loadPolicyForCommissions(policyId);
  if (!canAccessPolicy(actor, policyInvolved(policy))) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta póliza.");
  }

  const items = await prisma.commissionExpectation.findMany({
    where: { policyId },
    select: expectationSelect,
    orderBy: { period: "desc" },
  });
  return items.map(attachDerived);
}

export async function createCommissionExpectation(actor: AuthorizedUser, rawInput: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const input = parseOrThrow(createCommissionExpectationSchema, rawInput);

  const policy = await loadPolicyForCommissions(input.policyId);
  if (input.agentId) await assertActiveAgentId(input.agentId);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const expectation = await tx.commissionExpectation.create({
        data: {
          policyId: input.policyId,
          period: input.period,
          expectedAmount: input.expectedAmount,
          agentId: input.agentId ?? null,
        },
        select: { id: true },
      });
      // Nunca el monto en el audit log (ver docs/SECURITY.md).
      await recordAuditEvent(tx, {
        actor,
        entityType: "CommissionExpectation",
        entityId: expectation.id,
        action: "COMMISSION_EXPECTATION_CREATE",
        policyId: input.policyId,
        contactPersonId: policy.holder.id,
        summary: "Expectativa de comisión creada manualmente",
      });
      return expectation;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "Ya existe una comisión esperada para esta póliza y período."
      );
    }
    throw error;
  }
  return getCommissionExpectationById(actor, created.id);
}

export async function updateCommissionExpectation(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown
) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionExpectationIdSchema, rawId);
  const input = parseOrThrow(updateCommissionExpectationSchema, rawInput);

  const existing = await prisma.commissionExpectation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      expectedAmount: true,
      calculatedAmount: true,
      policyId: true,
      policy: { select: { holderId: true } },
      payments: { select: { id: true }, take: 1 },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Comisión no encontrada.");

  if (input.period !== undefined && existing.payments.length > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "period: No se puede cambiar el período de una comisión que ya tiene movimientos registrados."
    );
  }

  if (input.agentId !== undefined && input.agentId !== null) {
    await assertActiveAgentId(input.agentId);
  }

  const data: Prisma.CommissionExpectationUncheckedUpdateInput = {};
  if (input.expectedAmount !== undefined) {
    data.expectedAmount = input.expectedAmount;
    // Override manual (hallazgo #14.4/#14.5): solo se marca cuando el
    // nuevo monto realmente difiere del calculado por la regla — si la
    // expectativa nunca tuvo regla (calculatedAmount null) o el ADMIN
    // "corrige" hacia el mismo valor calculado, no se marca como
    // override. calculatedAmount en sí NUNCA se toca aquí — es el
    // registro histórico de qué produjo la regla, se conserva siempre.
    const calculated = existing.calculatedAmount;
    const changedFromCalculated =
      calculated === null || !new Prisma.Decimal(calculated).equals(new Prisma.Decimal(input.expectedAmount));
    if (calculated !== null && changedFromCalculated) {
      data.isManualOverride = true;
      data.overriddenById = actor.id;
      data.overriddenAt = new Date();
      if (input.overrideReason !== undefined) data.overrideReason = input.overrideReason;
    }
  }
  if (input.agentId !== undefined) data.agentId = input.agentId;
  if (input.period !== undefined) data.period = input.period;

  const isOverride = data.isManualOverride === true;
  // Nunca se guardan montos (expectedAmount/calculatedAmount) en el
  // audit log — solo el hecho de que hubo una corrección manual, quién
  // y cuándo (ya lo guarda la propia fila de CommissionExpectation).
  const changes = buildDiff(existing, input, ["agentId", "period"]);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.commissionExpectation.update({ where: { id }, data });
      if (isOverride || changes) {
        await recordAuditEvent(tx, {
          actor,
          entityType: "CommissionExpectation",
          entityId: id,
          action: isOverride ? "COMMISSION_EXPECTATION_OVERRIDE" : "COMMISSION_EXPECTATION_UPDATE",
          policyId: existing.policyId,
          contactPersonId: existing.policy.holderId,
          summary: isOverride
            ? "Expectativa de comisión corregida manualmente"
            : "Expectativa de comisión actualizada",
          changes,
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "Ya existe una comisión esperada para esta póliza y período."
      );
    }
    throw error;
  }
  return getCommissionExpectationById(actor, id);
}

// Nunca se borra una CommissionExpectation — pasa a CANCELLED. Los
// pagos ya registrados quedan intactos y visibles; no se acepta ningún
// movimiento nuevo (ni PAYMENT ni CHARGEBACK ni ADJUSTMENT) mientras
// esté CANCELLED — "mantener simple" (ver docs/DECISIONS.md).
export async function cancelCommissionExpectation(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionExpectationIdSchema, rawId);

  const existing = await prisma.commissionExpectation.findUnique({
    where: { id },
    select: { id: true, policyId: true, policy: { select: { holderId: true } } },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Comisión no encontrada.");

  await prisma.$transaction(async (tx) => {
    await tx.commissionExpectation.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionExpectation",
      entityId: id,
      action: "COMMISSION_EXPECTATION_UPDATE",
      policyId: existing.policyId,
      contactPersonId: existing.policy.holderId,
      summary: "Expectativa de comisión cancelada",
    });
  });
  return getCommissionExpectationById(actor, id);
}

// Normaliza el signo de amount según type — ver comentario en
// addCommissionPaymentSchema. Esta es la única fuente de verdad para
// esta convención: nunca se confía en un signo enviado por el cliente
// para PAYMENT/CHARGEBACK.
function normalizePaymentAmount(type: "PAYMENT" | "CHARGEBACK" | "ADJUSTMENT", raw: string): Prisma.Decimal {
  const magnitude = new Prisma.Decimal(raw).abs();

  if (type === "PAYMENT") {
    if (magnitude.isZero()) {
      throw new AppError("VALIDATION_ERROR", "amount: El monto de un pago debe ser mayor a 0.");
    }
    return magnitude;
  }
  if (type === "CHARGEBACK") {
    if (magnitude.isZero()) {
      throw new AppError("VALIDATION_ERROR", "amount: El monto de un chargeback debe ser mayor a 0.");
    }
    return magnitude.negated();
  }
  // ADJUSTMENT: se preserva el signo tal como fue enviado (puede ser
  // positivo o negativo), pero nunca puede ser 0.
  const signed = new Prisma.Decimal(raw);
  if (signed.isZero()) {
    throw new AppError("VALIDATION_ERROR", "amount: El ajuste no puede ser 0.");
  }
  return signed;
}

export async function addCommissionPayment(
  actor: AuthorizedUser,
  rawExpectationId: unknown,
  rawInput: unknown
) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const expectationId = parseOrThrow(commissionExpectationIdSchema, rawExpectationId);
  const input = parseOrThrow(addCommissionPaymentSchema, rawInput);

  const expectation = await prisma.commissionExpectation.findUnique({
    where: { id: expectationId },
    select: { id: true, status: true, policyId: true, policy: { select: { holderId: true } } },
  });
  if (!expectation) throw new AppError("NOT_FOUND", "Comisión no encontrada.");
  if (expectation.status === "CANCELLED") {
    throw new AppError(
      "VALIDATION_ERROR",
      "No se pueden registrar movimientos en una comisión cancelada."
    );
  }

  const amount = normalizePaymentAmount(input.type, input.amount);
  const ACTION_BY_TYPE = {
    PAYMENT: "COMMISSION_PAYMENT",
    CHARGEBACK: "COMMISSION_CHARGEBACK",
    ADJUSTMENT: "COMMISSION_ADJUSTMENT",
  } as const;
  const SUMMARY_BY_TYPE = {
    PAYMENT: "Pago de comisión registrado",
    CHARGEBACK: "Chargeback de comisión registrado",
    ADJUSTMENT: "Ajuste de comisión registrado",
  } as const;

  await prisma.$transaction(async (tx) => {
    const payment = await tx.commissionPayment.create({
      data: {
        commissionExpectationId: expectationId,
        amount,
        type: input.type,
        receivedAt: input.receivedAt,
        externalReference: input.externalReference ?? null,
        notes: input.notes ?? null,
      },
    });
    // Nunca el monto en el audit log (ver docs/SECURITY.md) — el id del
    // pago ya permite referenciarlo si hiciera falta.
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionPayment",
      entityId: payment.id,
      action: ACTION_BY_TYPE[input.type],
      policyId: expectation.policyId,
      contactPersonId: expectation.policy.holderId,
      summary: SUMMARY_BY_TYPE[input.type],
    });
  });

  return getCommissionExpectationById(actor, expectationId);
}
