import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { assertCanAccessPolicy, type PolicyAccessPersons } from "@/services/policies.service";
import { policyIdSchema } from "@/schemas/policy.schema";
import { listPremiumTrackingQuerySchema, updatePremiumTrackingSchema } from "@/schemas/premium.schema";
import { getDateOnlyParts } from "@/lib/date-only";
import { getTodayBusinessRange } from "@/lib/business-time";
import type { Prisma, PaymentStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Seguimiento de primas y pagos — Fase 017
//
// LIMITACIÓN DE DISEÑO IMPORTANTE: no existe ninguna entidad de pagos.
// Los 6 campos que gestiona este servicio (premiumAmount,
// billingFrequency, nextPaymentDueDate, autopay, needsPaymentAssistance,
// paymentStatus) viven directamente en Policy. Este módulo representa
// ÚNICAMENTE el estado actual / próximo pago de una póliza — nunca un
// historial de pagos, recibos, pagos parciales ni conciliación. Los
// nombres de las funciones evitan deliberadamente la palabra "Payment"
// en plural/como sustantivo de entidad (ej. "listPremiumTracking", no
// "listPayments") para no insinuar que existe una tabla de movimientos
// (ver docs/DECISIONS.md).
//
// Clasificación de seguridad: FINANCIERO OPERATIVO — distinto de
// Comisiones (FINANCIERO RESTRINGIDO, ver commissions.service.ts).
// Autorización (V1):
//   ADMIN: acceso total.
//   AGENT: ve/edita seguimiento de pago solo de pólizas donde ya tiene
//     acceso operativo (misma regla que canAccessPolicy).
//   ASSISTANT: acceso total, igual que ADMIN/AGENT sin restricción de
//     asignación — este es un módulo operativo, no financiero del
//     agente ni de salud; a diferencia de Comisiones, ASSISTANT SÍ
//     participa en el seguimiento de pagos del día a día.
// ---------------------------------------------------------------------------

const policySummarySelect = {
  id: true,
  policyNumber: true,
  premiumAmount: true,
  billingFrequency: true,
  nextPaymentDueDate: true,
  autopay: true,
  needsPaymentAssistance: true,
  paymentStatus: true,
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

type PremiumTrackingRow = Prisma.PolicyGetPayload<{ select: typeof policySummarySelect }>;

function policyInvolved(policy: PremiumTrackingRow): PolicyAccessPersons {
  return [policy.holder, ...policy.members.map((m) => m.person)];
}

function agentPremiumAccessWhere(actor: AuthorizedUser): Prisma.PolicyWhereInput | null {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return null;
  return {
    OR: [
      { holder: { assignedAgentId: null } },
      { holder: { assignedAgentId: actor.id } },
      { members: { some: { person: { assignedAgentId: null } } } },
      { members: { some: { person: { assignedAgentId: actor.id } } } },
    ],
  };
}

function dateOnlyTimestamp(parts: { year: number; month: number; day: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

// Pura y exportada (mismo patrón que isTaskOverdue/computeNextOccurrence)
// para poder probarla con fechas de referencia fijas. Regla conservadora
// pedida explícitamente: un paymentStatus = CURRENT ("al día") nunca se
// marca vencido, aunque la fecha ya haya pasado — CURRENT es un hecho de
// negocio más fuerte que la comparación de fechas.
export function isPaymentOverdue(
  policy: { nextPaymentDueDate: Date | null; paymentStatus: PaymentStatus | null },
  today: { year: number; month: number; day: number }
): boolean {
  if (!policy.nextPaymentDueDate) return false;
  if (policy.paymentStatus === "CURRENT") return false;
  const dueTs = dateOnlyTimestamp(getDateOnlyParts(policy.nextPaymentDueDate));
  return dueTs < dateOnlyTimestamp(today);
}

function attachDerived(policy: PremiumTrackingRow, today: { year: number; month: number; day: number }) {
  return { ...policy, isOverdue: isPaymentOverdue(policy, today) };
}

// "Vence hoy"/"próximos N días" excluyen paymentStatus = CURRENT por el
// mismo motivo que isPaymentOverdue: si ya está marcada al día, no
// necesita aparecer en una vista de "qué requiere atención", aunque
// nextPaymentDueDate todavía no se haya actualizado.
function notCurrentWhere(): Prisma.PolicyWhereInput {
  return { OR: [{ paymentStatus: null }, { paymentStatus: { not: "CURRENT" } }] };
}

export async function listPremiumTracking(actor: AuthorizedUser, rawQuery: unknown) {
  const {
    page,
    pageSize,
    search,
    dueToday,
    next7Days,
    next30Days,
    overdueOnly,
    needsAssistance,
    autopay,
    paymentStatus,
    carrierId,
    agentId,
  } = parseOrThrow(listPremiumTrackingQuerySchema, rawQuery);

  const today = getTodayBusinessRange();
  const todayUtc = new Date(dateOnlyTimestamp(today));

  const dateWindowWhere: Prisma.PolicyWhereInput[] = [];
  if (overdueOnly) {
    dateWindowWhere.push({ nextPaymentDueDate: { lt: todayUtc } }, notCurrentWhere());
  } else if (dueToday) {
    dateWindowWhere.push({ nextPaymentDueDate: todayUtc }, notCurrentWhere());
  } else if (next7Days) {
    const end = new Date(Date.UTC(today.year, today.month - 1, today.day + 7));
    dateWindowWhere.push({ nextPaymentDueDate: { gte: todayUtc, lte: end } }, notCurrentWhere());
  } else if (next30Days) {
    const end = new Date(Date.UTC(today.year, today.month - 1, today.day + 30));
    dateWindowWhere.push({ nextPaymentDueDate: { gte: todayUtc, lte: end } }, notCurrentWhere());
  }

  const where: Prisma.PolicyWhereInput = {
    ...(needsAssistance !== undefined ? { needsPaymentAssistance: needsAssistance } : {}),
    ...(autopay !== undefined ? { autopay } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(carrierId ? { product: { carrierId } } : {}),
    ...(agentId
      ? {
          OR: [
            { holder: { assignedAgentId: agentId } },
            { members: { some: { person: { assignedAgentId: agentId } } } },
          ],
        }
      : {}),
    ...(search
      ? {
          OR: [
            { policyNumber: { contains: search, mode: "insensitive" } },
            { holder: { firstName: { contains: search, mode: "insensitive" } } },
            { holder: { lastName: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(dateWindowWhere.length > 0 ? { AND: dateWindowWhere } : {}),
  };

  const agentWhere = agentPremiumAccessWhere(actor);
  const finalWhere: Prisma.PolicyWhereInput = agentWhere ? { AND: [where, agentWhere] } : where;

  // Promise.all, no prisma.$transaction([...]) — ver docs/DECISIONS.md
  // ("Advertencia de concurrencia pg", Fase 019.6).
  const [items, total] = await Promise.all([
    prisma.policy.findMany({
      where: finalWhere,
      select: policySummarySelect,
      orderBy: [{ nextPaymentDueDate: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.policy.count({ where: finalWhere }),
  ]);

  return { items: items.map((p) => attachDerived(p, today)), total, page, pageSize };
}

export async function getPremiumTrackingForPolicy(actor: AuthorizedUser, rawPolicyId: unknown) {
  const id = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await prisma.policy.findUnique({ where: { id }, select: policySummarySelect });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, policyInvolved(policy));

  const today = getTodayBusinessRange();
  return attachDerived(policy, today);
}

// Único punto de escritura de los 6 campos de seguimiento de pago —
// nunca toca ninguna otra columna de Policy (ver premium.schema.ts).
export async function updatePremiumTracking(actor: AuthorizedUser, rawPolicyId: unknown, rawInput: unknown) {
  const id = parseOrThrow(policyIdSchema, rawPolicyId);
  const input = parseOrThrow(updatePremiumTrackingSchema, rawInput);

  const existing = await prisma.policy.findUnique({
    where: { id },
    select: {
      id: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [existing.holder, ...existing.members.map((m) => m.person)]);

  const data: Prisma.PolicyUncheckedUpdateInput = {
    autopay: input.autopay,
    needsPaymentAssistance: input.needsPaymentAssistance,
  };
  if (input.premiumAmount !== undefined) data.premiumAmount = input.premiumAmount;
  if (input.billingFrequency !== undefined) data.billingFrequency = input.billingFrequency;
  if (input.nextPaymentDueDate !== undefined) data.nextPaymentDueDate = input.nextPaymentDueDate;
  if (input.paymentStatus !== undefined) data.paymentStatus = input.paymentStatus;

  await prisma.policy.update({ where: { id }, data });
  return getPremiumTrackingForPolicy(actor, id);
}

// setPaymentStatus* son atajos deliberadamente estrechos: cambian
// ÚNICAMENTE paymentStatus, nunca nextPaymentDueDate — avanzar
// automáticamente la próxima fecha de pago requeriría asumir un
// calendario de facturación del carrier que no tenemos (ver
// docs/DECISIONS.md). El usuario ajusta la fecha manualmente si
// corresponde, desde "Editar seguimiento de pago".
async function setPaymentStatus(actor: AuthorizedUser, rawPolicyId: unknown, status: PaymentStatus) {
  const id = parseOrThrow(policyIdSchema, rawPolicyId);
  const existing = await prisma.policy.findUnique({
    where: { id },
    select: {
      id: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [existing.holder, ...existing.members.map((m) => m.person)]);

  await prisma.policy.update({ where: { id }, data: { paymentStatus: status } });
  return getPremiumTrackingForPolicy(actor, id);
}

// No existe un valor de enum "PAID" (ver docs/DECISIONS.md) — CURRENT
// ("Al día") es el estado que representa un pago al corriente. Se
// nombra "markPaymentCurrent", no "markPremiumPaid", para no dar a
// entender que el sistema registra un pago real.
export function markPaymentCurrent(actor: AuthorizedUser, rawPolicyId: unknown) {
  return setPaymentStatus(actor, rawPolicyId, "CURRENT");
}
export function markPaymentDue(actor: AuthorizedUser, rawPolicyId: unknown) {
  return setPaymentStatus(actor, rawPolicyId, "DUE");
}
export function markPaymentPastDue(actor: AuthorizedUser, rawPolicyId: unknown) {
  return setPaymentStatus(actor, rawPolicyId, "PAST_DUE");
}
