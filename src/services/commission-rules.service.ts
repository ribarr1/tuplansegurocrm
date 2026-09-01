import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { assertCanAccessPolicy } from "@/services/policies.service";
import {
  commissionRuleIdSchema,
  createCommissionRuleSchema,
  generateExpectationsSchema,
} from "@/schemas/commission-rule.schema";
import { productIdSchema } from "@/schemas/product.schema";
import { policyIdSchema } from "@/schemas/policy.schema";

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

  if (input.policyId) {
    const policy = await prisma.policy.findUnique({
      where: { id: input.policyId },
      select: { id: true, productId: true },
    });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
    if (policy.productId !== input.productId) {
      throw new AppError("VALIDATION_ERROR", "policyId: Esta póliza no pertenece al producto seleccionado.");
    }
  }

  return prisma.commissionRule.create({
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
}

export async function deactivateCommissionRule(actor: AuthorizedUser, rawId: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionRuleIdSchema, rawId);
  const existing = await prisma.commissionRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Regla no encontrada.");
  return prisma.commissionRule.update({ where: { id }, data: { isActive: false }, select: ruleSelect });
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

// Genera (o no) UNA CommissionExpectation para UNA póliza y UN período
// explícito — nunca un rango abierto (evita "expectativas infinitas").
// Idempotente vía el mismo constraint único (policyId, period) que ya
// usa Comisiones (Fase 016): si ya existe una expectativa para ese
// período, se deja intacta y se reporta, nunca se sobrescribe —
// tampoco si la regla cambió desde entonces (una CommissionRule nueva
// solo afecta generaciones futuras, nunca reescribe historial).
export async function generateExpectationForPeriod(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(generateExpectationsSchema, rawInput);

  const policy = await prisma.policy.findUnique({
    where: { id: input.policyId },
    select: {
      id: true,
      productId: true,
      premiumAmount: true,
      effectiveDate: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
      _count: { select: { members: true } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  const existing = await prisma.commissionExpectation.findUnique({
    where: { policyId_period: { policyId: policy.id, period: input.period } },
    select: { id: true },
  });
  if (existing) {
    return { status: "ALREADY_EXISTS" as const, expectationId: existing.id };
  }

  const rule = await resolveApplicableRule(policy.id, policy.productId);
  if (!rule) {
    return { status: "NO_RULE" as const };
  }

  const result = computeExpectedAmount(rule, policy, policy._count.members, input.period);
  if ("skipped" in result) {
    return { status: "SKIPPED" as const, reason: result.reason };
  }

  const created = await prisma.commissionExpectation.create({
    data: {
      policyId: policy.id,
      period: input.period,
      expectedAmount: result.amount,
    },
    select: { id: true },
  });
  return { status: "CREATED" as const, expectationId: created.id };
}
