import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { assertCanAccessPolicy, assertPolicyIsMutable } from "@/services/policies.service";
import {
  commissionRuleIdSchema,
  createCommissionRuleSchema,
  generateExpectationsSchema,
} from "@/schemas/commission-rule.schema";
import { productIdSchema } from "@/schemas/product.schema";
import { policyIdSchema } from "@/schemas/policy.schema";
import { getTodayBusinessRange } from "@/lib/business-time";
import { recordAuditEvent } from "@/services/audit.service";
import { linkPendingPaymentsToExpectation } from "@/services/commission-payment-linking";

// ---------------------------------------------------------------------------
// Reglas de comisión — Fase 019.5
//
// CommissionRule describe CÓMO se genera una CommissionExpectation —
// nunca reemplaza CommissionExpectation/CommissionPayment (que siguen
// siendo, respectivamente, "cuánto esperamos" y "qué se recibió
// realmente"). Vive a nivel Product (policyId = null) con posible
// override por Policy — generateExpectationForPeriod resuelve primero
// el override, luego el producto.
//
// FINANCIERO / RESTRINGIDO, misma clasificación que Comisiones (Fase
// 016): ADMIN administra reglas y genera expectativas; AGENT/ASSISTANT
// nunca — configurar cómo se paga al negocio es una decisión
// administrativa, no operativa.
// ---------------------------------------------------------------------------

const ruleSelect = {
  id: true,
  productId: true,
  policyId: true,
  method: true,
  base: true,
  initialAmount: true,
  initialPercentage: true,
  initialPeriodicity: true,
  residualEnabled: true,
  residualAmount: true,
  residualPercentage: true,
  residualPeriodicity: true,
  residualStartYear: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.CommissionRuleSelect;

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar reglas de comisión.");
  }
}

export async function listCommissionRulesForProduct(actor: AuthorizedUser, rawProductId: unknown) {
  assertAdminOnly(actor);
  const productId = parseOrThrow(productIdSchema, rawProductId);
  return prisma.commissionRule.findMany({
    where: { productId },
    select: ruleSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createCommissionRule(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createCommissionRuleSchema, rawInput);

  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } });
  if (!product) throw new AppError("NOT_FOUND", "Producto no encontrado.");

  let policyHolderId: string | null = null;
  let policyHouseholdId: string | null = null;
  if (input.policyId) {
    const policy = await prisma.policy.findUnique({
      where: { id: input.policyId },
      select: { id: true, productId: true, status: true, holderId: true, householdId: true },
    });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
    if (policy.productId !== input.productId) {
      throw new AppError("VALIDATION_ERROR", "policyId: Esta póliza no pertenece al producto seleccionado.");
    }
    // Fase 025.4 (UAT-01): un override de comisión POR PÓLIZA es una
    // mutación derivada de esa póliza — nunca se crea/reemplaza contra
    // una CANCELLED/EXPIRED. Una regla a nivel de Product (policyId
    // null) no está sujeta a esto, no pertenece a ninguna póliza en
    // particular.
    assertPolicyIsMutable(policy.status);
    policyHolderId = policy.holderId;
    policyHouseholdId = policy.householdId;
  }

  return prisma.$transaction(async (tx) => {
    // Fase 025 (Hallazgo #6 de UAT, Parte F): máximo una regla ACTIVE
    // por scope (nivel producto si policyId es null, o el override de
    // ESTA póliza si no) — forzado también a nivel de DB con un índice
    // único parcial (ver migración 016), pero aquí se resuelve de forma
    // explícita ("esto reemplazará la regla activa actual") en vez de
    // dejar que la creación simplemente falle con un error de
    // constraint poco claro para el usuario. Atómico: desactivar +
    // crear ocurren en la misma transacción.
    const { count: replacedCount } = await tx.commissionRule.updateMany({
      where: { productId: input.productId, policyId: input.policyId ?? null, isActive: true },
      data: { isActive: false },
    });
    const created = await tx.commissionRule.create({
      data: {
        productId: input.productId,
        policyId: input.policyId ?? null,
        method: input.method,
        base: input.base,
        initialAmount: input.method === "FIXED_AMOUNT" ? input.initialAmount : null,
        initialPercentage: input.method === "PERCENTAGE" ? input.initialPercentage : null,
        initialPeriodicity: input.initialPeriodicity,
        residualEnabled: input.residualEnabled,
        residualAmount: input.residualEnabled && input.method === "FIXED_AMOUNT" ? input.residualAmount : null,
        residualPercentage:
          input.residualEnabled && input.method === "PERCENTAGE" ? input.residualPercentage : null,
        residualPeriodicity: input.residualEnabled ? input.residualPeriodicity : null,
        residualStartYear: input.residualEnabled ? input.residualStartYear : null,
      },
      select: ruleSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionRule",
      entityId: created.id,
      action: "COMMISSION_RULE_CREATE",
      policyId: input.policyId ?? null,
      householdId: policyHouseholdId,
      contactPersonId: policyHolderId,
      summary:
        replacedCount > 0
          ? "Regla de comisión creada (reemplaza la regla activa anterior de este scope)"
          : "Regla de comisión creada",
    });
    return created;
  });
}

export async function deactivateCommissionRule(actor: AuthorizedUser, rawId: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionRuleIdSchema, rawId);
  const existing = await prisma.commissionRule.findUnique({
    where: { id },
    select: {
      id: true,
      policyId: true,
      policy: { select: { status: true, holderId: true, householdId: true } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Regla no encontrada.");
  // Fase 025.4 (UAT-01): solo aplica a un override de póliza
  // (existing.policy no-null); una regla de Product no tiene póliza
  // que revisar.
  if (existing.policy) assertPolicyIsMutable(existing.policy.status);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.commissionRule.update({
      where: { id },
      data: { isActive: false },
      select: ruleSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionRule",
      entityId: id,
      action: "COMMISSION_RULE_UPDATE",
      policyId: existing.policyId,
      householdId: existing.policy?.householdId ?? null,
      contactPersonId: existing.policy?.holderId ?? null,
      summary: "Regla de comisión desactivada",
    });
    return updated;
  });
}

// Override de Policy (si existe y está activo) > regla de Product
// activa más reciente > ninguna. Nunca combina ambas.
async function resolveApplicableRule(policyId: string, productId: string) {
  const override = await prisma.commissionRule.findFirst({
    where: { policyId, isActive: true },
    select: ruleSelect,
    orderBy: { createdAt: "desc" },
  });
  if (override) return override;

  return prisma.commissionRule.findFirst({
    where: { productId, policyId: null, isActive: true },
    select: ruleSelect,
    orderBy: { createdAt: "desc" },
  });
}

function monthsBetween(effectiveDate: Date, period: Date): number {
  return (
    (period.getUTCFullYear() - effectiveDate.getUTCFullYear()) * 12 +
    (period.getUTCMonth() - effectiveDate.getUTCMonth())
  );
}

// Pura y exportada para poder probarla sin DB — decide el monto y si la
// regla aplica al período solicitado en absoluto (ver docs/DECISIONS.md
// para el razonamiento de ONE_TIME/MONTHLY/ANNUAL).
export function computeExpectedAmount(
  rule: {
    method: "FIXED_AMOUNT" | "PERCENTAGE";
    base: "PREMIUM_MONTHLY" | "PREMIUM_ANNUALIZED" | "PER_MEMBER" | "FIXED" | "OTHER";
    initialAmount: Prisma.Decimal | string | null;
    initialPercentage: Prisma.Decimal | string | null;
    initialPeriodicity: "ONE_TIME" | "MONTHLY" | "ANNUAL";
    residualEnabled: boolean;
    residualAmount: Prisma.Decimal | string | null;
    residualPercentage: Prisma.Decimal | string | null;
    residualPeriodicity: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
    residualStartYear: number | null;
  },
  policy: { premiumAmount: Prisma.Decimal | string | null; effectiveDate: Date | null },
  coveredMemberCount: number,
  period: Date
): { amount: Prisma.Decimal } | { skipped: true; reason: string } {
  if (!policy.effectiveDate) return { skipped: true, reason: "NO_EFFECTIVE_DATE" };
  const months = monthsBetween(policy.effectiveDate, period);
  if (months < 0) return { skipped: true, reason: "PERIOD_BEFORE_EFFECTIVE_DATE" };

  const policyYear = Math.floor(months / 12) + 1;
  const useResidual = rule.residualEnabled && rule.residualStartYear !== null && policyYear >= rule.residualStartYear;

  const periodicity = useResidual ? rule.residualPeriodicity! : rule.initialPeriodicity;
  if (periodicity === "ONE_TIME" && months !== 0) {
    return { skipped: true, reason: "ONE_TIME_NOT_FIRST_MONTH" };
  }
  if (periodicity === "ANNUAL" && months % 12 !== 0) {
    return { skipped: true, reason: "ANNUAL_NOT_ANNIVERSARY_MONTH" };
  }

  const amountField = useResidual ? rule.residualAmount : rule.initialAmount;
  const percentageField = useResidual ? rule.residualPercentage : rule.initialPercentage;
  const multiplier = rule.base === "PER_MEMBER" ? Math.max(coveredMemberCount, 0) : 1;

  if (rule.method === "FIXED_AMOUNT") {
    if (!amountField) return { skipped: true, reason: "MISSING_AMOUNT" };
    return { amount: new Prisma.Decimal(amountField).times(multiplier) };
  }

  // PERCENTAGE
  if (!percentageField) return { skipped: true, reason: "MISSING_PERCENTAGE" };
  if (!policy.premiumAmount) return { skipped: true, reason: "MISSING_PREMIUM" };
  const premium = new Prisma.Decimal(policy.premiumAmount);
  const base = rule.base === "PREMIUM_ANNUALIZED" ? premium.times(12) : premium;
  const amount = base.times(new Prisma.Decimal(percentageField).dividedBy(100)).times(multiplier);
  return { amount };
}

// Muestra qué regla se aplicaría a esta póliza ahora mismo (para la UI
// de "Regla aplicada" en Policy Detail) — no genera nada.
export async function getApplicableRuleForPolicy(actor: AuthorizedUser, rawPolicyId: unknown) {
  assertAdminOnly(actor);
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: { id: true, productId: true },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  return resolveApplicableRule(policy.id, policy.productId);
}

type GenerationResult =
  | { status: "CREATED"; expectationId: string }
  | { status: "ALREADY_EXISTS"; expectationId: string }
  | { status: "NO_RULE" }
  | { status: "SKIPPED"; reason: string };

// Núcleo sin autorización — usado tanto por la acción explícita
// (generateExpectationForPeriod, ADMIN) como por la generación
// automática (autoGenerateCurrentPeriodExpectation, disparada por el
// propio sistema al activar una póliza, asignar una regla, agregar un
// miembro o cambiar la prima — ver docs/DECISIONS.md). No verifica rol
// del actor porque no siempre hay un actor "editando comisiones" en el
// origen (ej. un AGENT agregando un PolicyMember) — la autorización de
// ESA operación ya ocurrió en su propio servicio; esto es un efecto
// secundario contable, no una acción que el usuario pide directamente.
//
// Nunca genera un rango abierto (evita "expectativas infinitas").
// Idempotente vía el mismo constraint único (policyId, period) que ya
// usa Comisiones (Fase 016): si ya existe una expectativa para ese
// período, se deja intacta y se reporta, nunca se sobrescribe —
// tampoco si la regla cambió desde entonces (una CommissionRule nueva
// solo afecta generaciones futuras, nunca reescribe historial).
async function generateExpectationCore(
  policyId: string,
  period: Date,
  actor: AuthorizedUser | null,
  options?: { requireActiveStatus?: boolean }
): Promise<GenerationResult> {
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      productId: true,
      premiumAmount: true,
      effectiveDate: true,
      status: true,
      holderId: true,
      householdId: true,
      _count: { select: { members: true } },
    },
  });
  if (!policy) return { status: "NO_RULE" };
  if (options?.requireActiveStatus && policy.status !== "ACTIVE") {
    return { status: "SKIPPED", reason: "POLICY_NOT_ACTIVE" };
  }

  const existing = await prisma.commissionExpectation.findUnique({
    where: { policyId_period: { policyId: policy.id, period } },
    select: { id: true },
  });
  if (existing) {
    return { status: "ALREADY_EXISTS", expectationId: existing.id };
  }

  const rule = await resolveApplicableRule(policy.id, policy.productId);
  if (!rule) {
    return { status: "NO_RULE" };
  }

  const result = computeExpectedAmount(rule, policy, policy._count.members, period);
  if ("skipped" in result) {
    return { status: "SKIPPED", reason: result.reason };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const expectation = await tx.commissionExpectation.create({
        data: {
          policyId: policy.id,
          period,
          expectedAmount: result.amount,
          calculatedAmount: result.amount,
          generatedByRuleId: rule.id,
        },
        select: { id: true },
      });
      // Nunca se guarda el monto en el audit log — ver docs/SECURITY.md
      // ("montos financieros nunca en logs normales"); el id de la fila
      // ya es suficiente para referenciarla si hiciera falta.
      await recordAuditEvent(tx, {
        actor,
        entityType: "CommissionExpectation",
        entityId: expectation.id,
        action: "COMMISSION_EXPECTATION_CREATE",
        policyId: policy.id,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: "Expectativa de comisión generada",
      });
      // Fase 025.5.5 (UAT-17): vincula retroactivamente pagos reales ya
      // recibidos para esta Policy+período antes de que existiera la
      // expectativa (ver commission-payment-linking.ts).
      await linkPendingPaymentsToExpectation(tx, {
        expectationId: expectation.id,
        policyId: policy.id,
        period,
        actor,
      });
      return expectation;
    });
    return { status: "CREATED", expectationId: created.id };
  } catch (error) {
    // Carrera: otra llamada (ej. dos disparadores automáticos casi
    // simultáneos) ya creó la fila entre el findUnique y el create —
    // el UNIQUE(policyId, period) lo protege a nivel de base de datos;
    // se reporta como ya existente en vez de dejar escapar un P2002.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.commissionExpectation.findUnique({
        where: { policyId_period: { policyId: policy.id, period } },
        select: { id: true },
      });
      if (raced) return { status: "ALREADY_EXISTS", expectationId: raced.id };
    }
    throw error;
  }
}

// Acción explícita del ADMIN ("Generar expectativa" en Policy Detail) —
// requiere período elegido a mano y verifica acceso a la póliza.
export async function generateExpectationForPeriod(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(generateExpectationsSchema, rawInput);

  const policy = await prisma.policy.findUnique({
    where: { id: input.policyId },
    select: {
      id: true,
      status: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);
  // Fase 025.4 (UAT-01): generar una expectativa manual es una
  // mutación derivada — nunca contra una CANCELLED/EXPIRED.
  assertPolicyIsMutable(policy.status);

  return generateExpectationCore(policy.id, input.period, actor);
}

// Generación automática — hallazgo #14 de UAT (Fase 019.7):
// CommissionRule debe ser la base real de CommissionExpectation, no
// solo informativa. Se llama desde la capa de Server Actions (nunca
// desde dentro de policies.service.ts, para evitar un import
// circular) cuando ocurre un evento relevante: activar una póliza,
// asignar/cambiar una CommissionRule, agregar un PolicyMember, o
// cambiar la prima. SIEMPRE "best effort": nunca lanza, nunca bloquea
// la operación principal — si la póliza no tiene regla aplicable, o el
// período ya tiene una expectativa (generada o manual), simplemente no
// hace nada. Horizonte deliberadamente acotado al mes de negocio
// actual (nunca meses futuros) — generar el futuro es siempre una
// acción explícita del ADMIN vía "Generar expectativa".
export async function autoGenerateCurrentPeriodExpectation(
  policyId: string,
  actor?: AuthorizedUser
): Promise<void> {
  try {
    const { year, month } = getTodayBusinessRange();
    const period = new Date(Date.UTC(year, month - 1, 1));
    await generateExpectationCore(policyId, period, actor ?? null, { requireActiveStatus: true });
  } catch {
    // Efecto secundario best-effort — un fallo aquí nunca debe romper
    // la operación que lo disparó (crear póliza, agregar miembro, etc.).
  }
}

// Fase 025.4 (UAT-04) — calendario automático completo para HEALTH
// con regla mensual aplicable: genera TODOS los meses desde
// effectiveDate hasta terminationDate (ambos inclusive), no solo el
// mes de negocio actual. Reutiliza generateExpectationCore mes a mes
// — ya es idempotente ((policyId, period) es UNIQUE) y ya respeta la
// periodicidad real de la regla (ONE_TIME/ANNUAL se SKIPPEA solos en
// los meses que no correspondan, ver computeExpectedAmount) — nunca
// se duplica esa lógica aquí, esta función solo decide EL RANGO de
// meses a intentar.
//
// Nunca genera un rango abierto: requiere effectiveDate Y
// terminationDate no-nulos. Solo aplica a HEALTH (ver ficha de UAT) y
// solo mientras la póliza está ACTIVE (mismo criterio que
// autoGenerateCurrentPeriodExpectation) — no tiene sentido generar
// expectativas futuras para una PENDING que todavía no empezó de
// verdad. Best-effort: nunca lanza, nunca bloquea la operación que la
// disparó (crear/renovar/editar póliza, asignar regla).
const MAX_SYNC_MONTHS = 240; // 20 años — salvaguarda contra datos corruptos, nunca un límite de negocio real.

export async function syncCommissionExpectationsForPolicy(
  policyId: string,
  actor?: AuthorizedUser
): Promise<void> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { id: policyId },
      select: {
        id: true,
        status: true,
        effectiveDate: true,
        terminationDate: true,
        product: { select: { policyType: true } },
      },
    });
    if (!policy) return;
    if (policy.status !== "ACTIVE") return;
    if (policy.product.policyType !== "HEALTH") return;
    if (!policy.effectiveDate || !policy.terminationDate) return;

    let year = policy.effectiveDate.getUTCFullYear();
    let month = policy.effectiveDate.getUTCMonth() + 1;
    const endYear = policy.terminationDate.getUTCFullYear();
    const endMonth = policy.terminationDate.getUTCMonth() + 1;

    for (let i = 0; i < MAX_SYNC_MONTHS; i++) {
      if (year > endYear || (year === endYear && month > endMonth)) break;
      const period = new Date(Date.UTC(year, month - 1, 1));
      await generateExpectationCore(policyId, period, actor ?? null, { requireActiveStatus: true });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  } catch {
    // Efecto secundario best-effort — nunca rompe la operación que lo
    // disparó, mismo criterio que autoGenerateCurrentPeriodExpectation.
  }
}

// Fase 025.4 (UAT-04) — limpieza de expectativas al cancelar una
// póliza. Se llama desde la capa de Server Actions DESPUÉS de que
// cancelPolicy ya dejó la Policy en CANCELLED (mismo motivo que
// autoGenerateCurrentPeriodExpectation: evitar un import circular con
// policies.service.ts, y porque UAT-01 exige que la póliza ya esté
// bloqueada antes de considerar terminados sus efectos derivados).
//
// Regla: expectativas ACTIVE cuyo período sea >= el mes de la fecha
// de cancelación REAL (terminationDate, nunca updatedAt) se procesan:
//   - Sin CommissionPayment asociado -> se retiran (delete real, nunca
//     representaron dinero recibido, no hay nada que preservar).
//   - Con CommissionPayment asociado -> NUNCA se borran (ver
//     CLAUDE.md §31 y la instrucción explícita de este hallazgo);
//     se marcan CANCELLED (el mismo estado que ya usa
//     cancelCommissionExpectation) y se audita el conflicto para
//     revisión administrativa — la cancelación de la póliza en sí
//     nunca se bloquea por esto.
// Los CommissionPayment, AuditEvent y meses ANTERIORES al de
// cancelación nunca se tocan.
export async function removeCommissionExpectationsAfterCancellation(
  policyId: string,
  cancellationDate: Date,
  actor: AuthorizedUser | null
): Promise<{ removed: number; flaggedWithPayments: number }> {
  const cancellationMonth = new Date(
    Date.UTC(cancellationDate.getUTCFullYear(), cancellationDate.getUTCMonth(), 1)
  );

  const candidates = await prisma.commissionExpectation.findMany({
    where: { policyId, status: "ACTIVE", period: { gte: cancellationMonth } },
    select: {
      id: true,
      policy: { select: { holderId: true, householdId: true } },
      payments: { select: { id: true } },
    },
  });

  let removed = 0;
  let flaggedWithPayments = 0;
  for (const exp of candidates) {
    if (exp.payments.length === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.commissionExpectation.delete({ where: { id: exp.id } });
        await recordAuditEvent(tx, {
          actor,
          entityType: "CommissionExpectation",
          entityId: exp.id,
          action: "COMMISSION_EXPECTATION_REMOVED_ON_CANCEL",
          policyId,
          householdId: exp.policy.householdId,
          contactPersonId: exp.policy.holderId,
          summary: "Expectativa de comisión retirada — mes posterior/igual al de cancelación, sin pagos asociados",
        });
      });
      removed++;
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.commissionExpectation.update({ where: { id: exp.id }, data: { status: "CANCELLED" } });
        await recordAuditEvent(tx, {
          actor,
          entityType: "CommissionExpectation",
          entityId: exp.id,
          action: "COMMISSION_EXPECTATION_UPDATE",
          policyId,
          householdId: exp.policy.householdId,
          contactPersonId: exp.policy.holderId,
          summary:
            "Expectativa de comisión marcada CANCELLED (mes posterior/igual al de cancelación) — NO se elimina porque ya tiene pagos/conciliación asociados; requiere revisión administrativa.",
          metadata: { reason: "post_cancellation_conflict_has_payments" },
        });
      });
      flaggedWithPayments++;
    }
  }
  return { removed, flaggedWithPayments };
}
