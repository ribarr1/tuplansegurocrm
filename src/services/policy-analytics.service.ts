import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { parseOrThrow } from "@/services/errors";
import { policyAnalyticsQuerySchema, type PolicyAnalyticsQuery } from "@/schemas/analytics.schema";
import { resolveAnalyticsPeriod, enumerateMonths } from "@/lib/analytics-period";
import { buildPolicyFilterWhere, policyAgentAccessWhere, listExpiringPolicies } from "@/services/policies.service";
import { Prisma, type PolicyType, type PolicyStatus, type PolicyBusinessSource } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Dashboard gráfico de pólizas.
//
// Reutiliza EXACTAMENTE los mismos filtros/alcance que el listado de
// Pólizas (buildPolicyFilterWhere, policyAgentAccessWhere) — nunca una
// segunda definición de "qué pólizas puede ver este actor" o "qué
// significa el filtro agentId" (que en Policy es `processedById`, NO
// `holder.assignedAgentId` — ver policies.service.ts, UAT-09).
//
// Cada indicador que agrupa por una dimensión NO escalar en Policy
// (carrier, tipo de póliza, estado geográfico, agente) usa
// prisma.policy.groupBy sobre la columna escalar real (productId,
// householdId, processedById) — agregado en la base de datos sobre el
// universo COMPLETO filtrado — y luego solo hace un "roll-up" en
// memoria de un catálogo pequeño (carriers/products/households/users)
// para traducir el id a una etiqueta legible. Nunca sacrifica exactitud
// por rendimiento: el conteo en sí siempre es SQL COUNT, nunca sumado
// en JS sobre filas de Policy cargadas una por una.
//
// LIMITACIÓN DOCUMENTADA (Sección 7 del ticket, "Estado geográfico"):
// el estado geográfico vive en Household.state, NO en Person/Policy
// directamente (ver prisma/schema.prisma) — y Policy.householdId es
// NULLABLE (solo se asigna cuando el titular pertenece a exactamente un
// hogar, ver createPolicy). Las pólizas sin hogar vinculado se agrupan
// bajo "Sin estado / sin hogar vinculado", nunca se ocultan ni se
// asumen en un estado arbitrario.
//
// LIMITACIÓN DOCUMENTADA ("qué fecha usa cada métrica" — Sección 2 del
// ticket): el esquema NO distingue una fecha de "cancelación" de una de
// "terminación" — cancelPolicy únicamente escribe terminationDate (el
// status ACTIVE/CANCELLED/EXPIRED es lo que distingue el HECHO, la
// fecha es la misma columna). "Terminaciones próximas" y
// "Renovaciones próximas" también colapsan en UNA sola señal real
// (mismo criterio ya usado por dashboard.service.ts: "próximas a
// vencer" — no existe en el esquema una forma de saber de antemano si
// una póliza próxima a terminar se renovará o simplemente vencerá).
// ---------------------------------------------------------------------------

function resolveDateClause(
  dateField: "CREATED" | "EFFECTIVE" | "TERMINATION",
  start: Date | null,
  end: Date | null
): Prisma.PolicyWhereInput {
  if (!start || !end) return {};
  if (dateField === "EFFECTIVE") return { effectiveDate: { gte: start, lt: end } };
  if (dateField === "TERMINATION") return { terminationDate: { gte: start, lt: end } };
  return { createdAt: { gte: start, lt: end } };
}

function withAnd(base: Prisma.PolicyWhereInput, extra: Prisma.PolicyWhereInput | null): Prisma.PolicyWhereInput {
  if (!extra) return base;
  return { AND: [base, extra] };
}

function buildBaseWhere(filters: PolicyAnalyticsQuery, dateClause: Prisma.PolicyWhereInput): Prisma.PolicyWhereInput {
  const filterWhere = buildPolicyFilterWhere({
    status: filters.status as PolicyStatus | undefined,
    policyType: filters.policyType as PolicyType | undefined,
    carrierId: filters.carrierId,
    agentId: filters.agentId,
    businessSource: filters.businessSource as PolicyBusinessSource | undefined,
  });
  return { ...filterWhere, ...dateClause };
}

const POLICY_STATUS_LABELS_ES: Record<string, string> = {
  PENDING: "Pendiente",
  ACTIVE: "Activa",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};
const BUSINESS_SOURCE_LABELS_ES: Record<string, string> = { OWN: "Propia", REFERRAL: "Referida", UNKNOWN: "Sin clasificar" };

export async function getPolicyAnalytics(actor: AuthorizedUser, rawQuery: unknown) {
  const filters = parseOrThrow(policyAnalyticsQuerySchema, rawQuery);
  const dateField = filters.dateField ?? "CREATED";
  const { start, end } = resolveAnalyticsPeriod(filters);
  const dateClause = resolveDateClause(dateField, start, end);
  const geoClause: Prisma.PolicyWhereInput = filters.geographicState
    ? { household: { state: filters.geographicState } }
    : {};

  const agentScope = policyAgentAccessWhere(actor);
  const where = withAnd({ ...buildBaseWhere(filters, dateClause), ...geoClause }, agentScope);
  // Versión SIN cláusula de fecha, para los gráficos de tendencia
  // mensual que siempre fijan su propia fecha (createdAt/terminationDate)
  // por mes — nunca se combina con el `dateField` elegido para el resto
  // del dashboard (ver comentario en getMonthlyNewPolicies). Se
  // construye aquí, ANTES de aplicar la cláusula de fecha, en vez de
  // intentar "restarla" después de envolver todo en un AND anidado con
  // el scope de agente — más simple y sin riesgo de desalinearse de la
  // forma real del objeto `where`.
  const whereWithoutDate = withAnd({ ...buildBaseWhere(filters, {}), ...geoClause }, agentScope);

  const [
    total,
    byStatus,
    byBusinessSource,
    byCarrier,
    byType,
    byGeographicState,
    byAgent,
    newByMonth,
    monthlyAltasCancelaciones,
    upcoming,
  ] = await Promise.all([
    prisma.policy.count({ where }),
    getStatusBreakdown(where),
    getBusinessSourceBreakdown(where, filters),
    getCarrierBreakdown(where, filters),
    getTypeBreakdown(where, filters),
    getGeographicStateBreakdown(where, filters),
    getAgentBreakdown(where, filters),
    getMonthlyNewPolicies(whereWithoutDate, start, end),
    getMonthlyAltasYCancelaciones(whereWithoutDate, start, end),
    listExpiringPolicies(actor, 30),
  ]);

  return {
    filters: { periodMode: filters.periodMode ?? "ALL", dateField, start, end },
    indicators: { total },
    charts: {
      byStatus,
      byBusinessSource,
      byCarrier,
      byType,
      byGeographicState,
      byAgent,
      newByMonth,
      monthlyAltasCancelaciones,
    },
    // "Renovaciones próximas" y "Terminaciones próximas" del ticket
    // colapsan en esta única lista — ver nota de limitación arriba.
    // Usa terminationDate (única fecha real disponible para esto).
    upcomingRenewalsOrTerminations: upcoming.map((p) => ({
      id: p.id,
      policyNumber: p.policyNumber,
      terminationDate: p.terminationDate,
      holderName: `${p.holder.firstName} ${p.holder.lastName}`,
      carrierName: p.product.carrier.name,
    })),
  };
}

async function getStatusBreakdown(where: Prisma.PolicyWhereInput) {
  const rows = await prisma.policy.groupBy({ by: ["status"], where, _count: { _all: true } });
  return rows.map((r) => ({ status: r.status, label: POLICY_STATUS_LABELS_ES[r.status] ?? r.status, count: r._count._all }));
}

async function getBusinessSourceBreakdown(where: Prisma.PolicyWhereInput, filters: PolicyAnalyticsQuery) {
  if (filters.businessSource) return [];
  const rows = await prisma.policy.groupBy({ by: ["businessSource"], where, _count: { _all: true } });
  return rows.map((r) => ({
    businessSource: r.businessSource,
    label: BUSINESS_SOURCE_LABELS_ES[r.businessSource] ?? r.businessSource,
    count: r._count._all,
  }));
}

async function getCarrierBreakdown(where: Prisma.PolicyWhereInput, filters: PolicyAnalyticsQuery) {
  if (filters.carrierId) return [];
  const rows = await prisma.policy.groupBy({ by: ["productId"], where, _count: { _all: true } });
  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, carrier: { select: { id: true, name: true } } },
  });
  const carrierByProductId = new Map(products.map((p) => [p.id, p.carrier]));

  const totals = new Map<string, { carrierId: string; carrierName: string; count: number }>();
  for (const row of rows) {
    const carrier = carrierByProductId.get(row.productId);
    if (!carrier) continue;
    const existing = totals.get(carrier.id);
    if (existing) existing.count += row._count._all;
    else totals.set(carrier.id, { carrierId: carrier.id, carrierName: carrier.name, count: row._count._all });
  }
  return Array.from(totals.values()).sort((a, b) => b.count - a.count);
}

async function getTypeBreakdown(where: Prisma.PolicyWhereInput, filters: PolicyAnalyticsQuery) {
  if (filters.policyType) return [];
  const rows = await prisma.policy.groupBy({ by: ["productId"], where, _count: { _all: true } });
  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, policyType: true },
  });
  const typeByProductId = new Map(products.map((p) => [p.id, p.policyType]));

  const totals = new Map<string, number>();
  for (const row of rows) {
    const policyType = typeByProductId.get(row.productId);
    if (!policyType) continue;
    totals.set(policyType, (totals.get(policyType) ?? 0) + row._count._all);
  }
  return Array.from(totals.entries())
    .map(([policyType, count]) => ({ policyType, count }))
    .sort((a, b) => b.count - a.count);
}

async function getGeographicStateBreakdown(where: Prisma.PolicyWhereInput, filters: PolicyAnalyticsQuery) {
  if (filters.geographicState) return [];
  const rows = await prisma.policy.groupBy({ by: ["householdId"], where, _count: { _all: true } });
  if (rows.length === 0) return [];

  const householdIds = rows.map((r) => r.householdId).filter((id): id is string => id !== null);
  const households = await prisma.household.findMany({
    where: { id: { in: householdIds } },
    select: { id: true, state: true },
  });
  const stateByHouseholdId = new Map(households.map((h) => [h.id, h.state]));

  const totals = new Map<string, number>();
  for (const row of rows) {
    const state = row.householdId ? (stateByHouseholdId.get(row.householdId) ?? null) : null;
    const key = state ?? "SIN_ESTADO";
    totals.set(key, (totals.get(key) ?? 0) + row._count._all);
  }
  return Array.from(totals.entries())
    .map(([state, count]) => ({
      state: state === "SIN_ESTADO" ? null : state,
      label: state === "SIN_ESTADO" ? "Sin estado / sin hogar vinculado" : state,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

async function getAgentBreakdown(where: Prisma.PolicyWhereInput, filters: PolicyAnalyticsQuery) {
  if (filters.agentId) return [];
  const rows = await prisma.policy.groupBy({ by: ["processedById"], where, _count: { _all: true } });
  if (rows.length === 0) return [];

  const agentIds = rows.map((r) => r.processedById).filter((id): id is string => id !== null);
  const agents = await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } });
  const nameByAgentId = new Map(agents.map((a) => [a.id, a.name]));

  return rows
    .map((r) => ({
      agentId: r.processedById,
      agentName: r.processedById ? (nameByAgentId.get(r.processedById) ?? "Agente") : "Sin procesar / sin asignar",
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

// "Nuevas por mes" — SIEMPRE usa createdAt, independientemente del
// selector `dateField` del resto del dashboard (ver comentario superior
// del archivo: cada métrica declara su propia fecha). Si no se
// seleccionó un período con límites definidos, se acota a los últimos
// 12 meses (nunca un desglose potencialmente ilimitado por defecto).
async function getMonthlyNewPolicies(whereWithoutDate: Prisma.PolicyWhereInput, start: Date | null, end: Date | null) {
  const { effectiveStart, effectiveEnd } = defaultTrendWindow(start, end);
  const months = enumerateMonths(effectiveStart, effectiveEnd);
  return Promise.all(
    months.map(async ({ year, month, start: monthStart, end: monthEnd }) => {
      const count = await prisma.policy.count({
        where: { ...whereWithoutDate, createdAt: { gte: monthStart, lt: monthEnd } },
      });
      return { year, month, label: `${year}-${String(month).padStart(2, "0")}`, count };
    })
  );
}

// "Tendencia mensual de altas y cancelaciones" — altas = createdAt;
// cancelaciones = terminationDate EN pólizas con status=CANCELLED (la
// única fecha real disponible para ese hecho, ver nota de limitación).
async function getMonthlyAltasYCancelaciones(
  whereWithoutDate: Prisma.PolicyWhereInput,
  start: Date | null,
  end: Date | null
) {
  const { effectiveStart, effectiveEnd } = defaultTrendWindow(start, end);
  const months = enumerateMonths(effectiveStart, effectiveEnd);
  return Promise.all(
    months.map(async ({ year, month, start: monthStart, end: monthEnd }) => {
      const [altas, cancelaciones] = await Promise.all([
        prisma.policy.count({ where: { ...whereWithoutDate, createdAt: { gte: monthStart, lt: monthEnd } } }),
        prisma.policy.count({
          where: { ...whereWithoutDate, status: "CANCELLED", terminationDate: { gte: monthStart, lt: monthEnd } },
        }),
      ]);
      return { year, month, label: `${year}-${String(month).padStart(2, "0")}`, altas, cancelaciones };
    })
  );
}

function defaultTrendWindow(start: Date | null, end: Date | null): { effectiveStart: Date; effectiveEnd: Date } {
  const now = new Date();
  const effectiveEnd = end ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const effectiveStart = start ?? new Date(Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth() - 12, 1));
  return { effectiveStart, effectiveEnd };
}
