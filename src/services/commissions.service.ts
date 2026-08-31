import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canAccessPolicy, type PolicyAccessPersons } from "@/services/policies.service";
import { policyIdSchema } from "@/schemas/policy.schema";
import {
  commissionExpectationIdSchema,
  listCommissionExpectationsQuerySchema,
  createCommissionExpectationSchema,
  updateCommissionExpectationSchema,
  addCommissionPaymentSchema,
} from "@/schemas/commission.schema";
import { Prisma } from "@/generated/prisma/client";

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

function agentCommissionAccessWhere(actor: AuthorizedUser): Prisma.CommissionExpectationWhereInput | null {
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

  const [items, total] = await prisma.$transaction([
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

  await loadPolicyForCommissions(input.policyId);
  if (input.agentId) await assertActiveAgentId(input.agentId);

  let created;
  try {
    created = await prisma.commissionExpectation.create({
      data: {
        policyId: input.policyId,
        period: input.period,
        expectedAmount: input.expectedAmount,
        agentId: input.agentId ?? null,
      },
      select: { id: true },
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
    select: { id: true, status: true, payments: { select: { id: true }, take: 1 } },
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
  if (input.expectedAmount !== undefined) data.expectedAmount = input.expectedAmount;
  if (input.agentId !== undefined) data.agentId = input.agentId;
  if (input.period !== undefined) data.period = input.period;

  try {
    await prisma.commissionExpectation.update({ where: { id }, data });
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
    select: { id: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Comisión no encontrada.");

  await prisma.commissionExpectation.update({
    where: { id },
    data: { status: "CANCELLED" },
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
    select: { id: true, status: true },
  });
  if (!expectation) throw new AppError("NOT_FOUND", "Comisión no encontrada.");
  if (expectation.status === "CANCELLED") {
    throw new AppError(
      "VALIDATION_ERROR",
      "No se pueden registrar movimientos en una comisión cancelada."
    );
  }

  const amount = normalizePaymentAmount(input.type, input.amount);

  await prisma.commissionPayment.create({
    data: {
      commissionExpectationId: expectationId,
      amount,
      type: input.type,
      receivedAt: input.receivedAt,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
    },
  });

  return getCommissionExpectationById(actor, expectationId);
}
