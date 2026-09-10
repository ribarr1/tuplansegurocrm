import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { parseOrThrow } from "@/services/errors";
import { commissionAnalyticsQuerySchema, type CommissionAnalyticsQuery } from "@/schemas/analytics.schema";
import { resolveAnalyticsPeriod, enumerateMonths } from "@/lib/analytics-period";
import {
  assertModuleAccess,
  agentCommissionAccessWhere,
  COMMISSION_DERIVED_STATUS_VALUES,
  computeCommissionStatus,
  sumPayments,
  type CommissionDerivedStatus,
} from "@/services/commissions.service";
import { Prisma } from "@/generated/prisma/client";
import type { PolicyType } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Dashboard gráfico de comisiones.
//
// Autorización: idéntica al resto del módulo de comisiones
// (assertModuleAccess — ASSISTANT sin acceso; agentCommissionAccessWhere
// — AGENT solo ve pólizas donde tiene acceso operativo; ADMIN ve todo).
// TODOS los cálculos se agregan en la base de datos (Prisma
// aggregate/count) sobre el universo COMPLETO filtrado, nunca sobre una
// página cargada en memoria — única excepción documentada: el desglose
// de "Estados de conciliación" (ver getReconciliationStatusBreakdown),
// que por naturaleza requiere un status DERIVADO por fila (no es una
// suma), así que carga solo las columnas mínimas necesarias de TODAS
// las expectativas del universo filtrado, nunca una página.
//
// DECISIÓN — "Asistencia" (ver resumen de la fase anterior): no existe
// columna de asistencia en CommissionExpectation ni en pagos manuales
// (addCommissionPayment). La única fuente real es
// CommissionStatementRow.assistanceAmount, poblada solo cuando el pago
// vino de una conciliación de statement importado. Esta fase NO agrega
// una columna nueva (evita un cambio de esquema no solicitado) — el
// indicador "Asistencia"/"Neto recibido" se calcula EXCLUSIVAMENTE
// sobre pagos vinculados a un CommissionStatementRow; los pagos
// manuales (Fase 016, addCommissionPayment) contribuyen $0 de
// asistencia a este indicador. Esto se documenta explícitamente en el
// reporte final como una limitación conocida, no un bug.
//
// DECISIÓN — "Estados de conciliación": usa el vocabulario GENERAL de
// salud de CommissionExpectation (COMMISSION_DERIVED_STATUS_VALUES:
// CANCELLED/ZERO/NO_EXPECTATION/NEGATIVE_BALANCE/PENDING/PARTIAL/PAID/
// OVERPAID), NO el vocabulario de la vista previa de conciliación de un
// statement concreto (reviewState en reconciliation.service.ts, que
// describe filas de UN archivo importado, no el portafolio completo).
// ---------------------------------------------------------------------------

function agentCommissionPaymentAccessWhere(actor: AuthorizedUser): Prisma.CommissionPaymentWhereInput | null {
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

type ResolvedFilters = CommissionAnalyticsQuery;

function buildExpectationWhere(
  filters: ResolvedFilters,
  periodClause: Prisma.CommissionExpectationWhereInput
): Prisma.CommissionExpectationWhereInput {
  return {
    ...periodClause,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    policy: {
      ...(filters.carrierId ? { product: { carrierId: filters.carrierId } } : {}),
      ...(filters.policyType ? { product: { policyType: filters.policyType as PolicyType } } : {}),
      ...(filters.businessSource ? { businessSource: filters.businessSource } : {}),
    },
  };
}

function buildPaymentWhere(
  filters: ResolvedFilters,
  periodClause: Prisma.CommissionPaymentWhereInput
): Prisma.CommissionPaymentWhereInput {
  return {
    ...periodClause,
    policy: {
      ...(filters.carrierId ? { product: { carrierId: filters.carrierId } } : {}),
      ...(filters.policyType ? { product: { policyType: filters.policyType as PolicyType } } : {}),
      ...(filters.businessSource ? { businessSource: filters.businessSource } : {}),
      ...(filters.agentId
        ? {
            OR: [
              { holder: { assignedAgentId: filters.agentId } },
              { members: { some: { person: { assignedAgentId: filters.agentId } } } },
            ],
          }
        : {}),
    },
  };
}

function withAnd<T extends object>(base: T, extra: T | null): T {
  if (!extra) return base;
  return { AND: [base, extra] } as unknown as T;
}

async function sumAssistanceAndNet(
  paymentWhere: Prisma.CommissionPaymentWhereInput
): Promise<{ assistance: Prisma.Decimal; net: Prisma.Decimal }> {
  const agg = await prisma.commissionStatementRow.aggregate({
    where: { payment: paymentWhere },
    _sum: { assistanceAmount: true, netAmount: true },
  });
  return {
    assistance: new Prisma.Decimal(agg._sum.assistanceAmount ?? 0),
    net: new Prisma.Decimal(agg._sum.netAmount ?? agg._sum.assistanceAmount ?? 0),
  };
}

async function computeTotalsFor(expectationWhere: Prisma.CommissionExpectationWhereInput, paymentWhere: Prisma.CommissionPaymentWhereInput) {
  const [expectationAgg, receivedAgg, unlinkedAgg, assistanceAndNet] = await Promise.all([
    prisma.commissionExpectation.aggregate({ where: expectationWhere, _sum: { expectedAmount: true }, _count: true }),
    prisma.commissionPayment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: true }),
    prisma.commissionPayment.aggregate({
      where: { ...paymentWhere, commissionExpectationId: null },
      _sum: { amount: true },
      _count: true,
    }),
    sumAssistanceAndNet(paymentWhere),
  ]);

  const expected = new Prisma.Decimal(expectationAgg._sum.expectedAmount ?? 0);
  const receivedGross = new Prisma.Decimal(receivedAgg._sum.amount ?? 0);
  const { assistance, net: netFromRows } = assistanceAndNet;
  // netReceived: Bruto - Asistencia (misma convención que
  // CommissionStatementRow.netAmount) — se recalcula aquí a partir de
  // receivedGross/assistance en vez de sumar netAmount directamente,
  // porque netAmount solo existe para filas de statement; un pago
  // manual sin fila de statement no tiene "neto" propio distinto de su
  // monto completo (no hay asistencia que restarle).
  const netReceived = receivedGross.minus(assistance);
  const difference = receivedGross.minus(expected);
  const pending = Prisma.Decimal.max(expected.minus(receivedGross), 0);
  const overpaid = Prisma.Decimal.max(receivedGross.minus(expected), 0);
  const pctReconciled = expected.isZero() ? null : receivedGross.dividedBy(expected).times(100);

  return {
    expectationCount: expectationAgg._count,
    expected,
    receivedGross,
    pending,
    overpaid,
    assistance,
    netReceived,
    // Expuesto para depuración/verificación cruzada — debe coincidir
    // con netReceived salvo redondeo, ya que ambos representan la
    // misma cantidad calculada por dos caminos distintos.
    netFromStatementRows: netFromRows,
    difference,
    pctReconciled,
    paymentsWithoutExpectationCount: unlinkedAgg._count,
    paymentsWithoutExpectationAmount: new Prisma.Decimal(unlinkedAgg._sum.amount ?? 0),
  };
}

export async function getCommissionAnalytics(actor: AuthorizedUser, rawQuery: unknown) {
  assertModuleAccess(actor);
  const filters = parseOrThrow(commissionAnalyticsQuerySchema, rawQuery);
  const { start, end } = resolveAnalyticsPeriod(filters);

  const expectationPeriodClause: Prisma.CommissionExpectationWhereInput =
    start && end ? { period: { gte: start, lt: end } } : {};
  const paymentPeriodClause: Prisma.CommissionPaymentWhereInput = start && end ? { period: { gte: start, lt: end } } : {};

  const agentExpectationScope = agentCommissionAccessWhere(actor);
  const agentPaymentScope = agentCommissionPaymentAccessWhere(actor);

  const baseExpectationWhere = withAnd(buildExpectationWhere(filters, expectationPeriodClause), agentExpectationScope);
  const basePaymentWhere = withAnd(buildPaymentWhere(filters, paymentPeriodClause), agentPaymentScope);

  const [overall, byCarrier, byAgent, byBusinessSource, monthlyTrend, reconciliationStatus] = await Promise.all([
    computeTotalsFor(baseExpectationWhere, basePaymentWhere),
    getBreakdownByCarrier(baseExpectationWhere, basePaymentWhere, filters),
    getBreakdownByAgent(actor, baseExpectationWhere, basePaymentWhere, filters),
    getBreakdownByBusinessSource(baseExpectationWhere, basePaymentWhere),
    getMonthlyTrend(baseExpectationWhere, basePaymentWhere, start, end),
    getReconciliationStatusBreakdown(baseExpectationWhere),
  ]);

  return {
    filters: { periodMode: filters.periodMode ?? "ALL", start, end },
    overall,
    charts: {
      byCarrier,
      byAgent,
      byBusinessSource,
      monthlyTrend,
      reconciliationStatus,
    },
  };
}

async function getBreakdownByCarrier(
  expectationWhere: Prisma.CommissionExpectationWhereInput,
  paymentWhere: Prisma.CommissionPaymentWhereInput,
  filters: ResolvedFilters
) {
  // Si ya se filtró por un carrier específico, el desglose "por
  // carrier" no aporta nada nuevo — se omite (nunca un gráfico de una
  // sola barra redundante con el total).
  if (filters.carrierId) return [];

  const carriers = await prisma.carrier.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results = await Promise.all(
    carriers.map(async (carrier) => {
      const scopedExpectationWhere: Prisma.CommissionExpectationWhereInput = {
        ...expectationWhere,
        policy: { ...(expectationWhere.policy as object), product: { carrierId: carrier.id } },
      };
      const scopedPaymentWhere: Prisma.CommissionPaymentWhereInput = {
        ...paymentWhere,
        policy: { ...(paymentWhere.policy as object), product: { carrierId: carrier.id } },
      };
      const [expectationAgg, receivedAgg] = await Promise.all([
        prisma.commissionExpectation.aggregate({ where: scopedExpectationWhere, _sum: { expectedAmount: true } }),
        prisma.commissionPayment.aggregate({ where: scopedPaymentWhere, _sum: { amount: true } }),
      ]);
      const expected = new Prisma.Decimal(expectationAgg._sum.expectedAmount ?? 0);
      const received = new Prisma.Decimal(receivedAgg._sum.amount ?? 0);
      return {
        carrierId: carrier.id,
        carrierName: carrier.name,
        expected,
        received,
        pending: Prisma.Decimal.max(expected.minus(received), 0),
      };
    })
  );

  // Nunca satura el gráfico con carriers sin ningún movimiento en el
  // universo filtrado.
  return results.filter((r) => !r.expected.isZero() || !r.received.isZero());
}

async function getBreakdownByAgent(
  actor: AuthorizedUser,
  expectationWhere: Prisma.CommissionExpectationWhereInput,
  paymentWhere: Prisma.CommissionPaymentWhereInput,
  filters: ResolvedFilters
) {
  if (filters.agentId) return [];

  // Un AGENT solo puede ver su propio desglose (su scope ya lo
  // restringe a esto de todas formas) — nunca se le expone la lista
  // completa de agentes de la agencia solo para poblar este gráfico.
  const agents =
    actor.role === "ADMIN"
      ? await prisma.user.findMany({
          where: { isAgent: true, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [{ id: actor.id, name: actor.name }];

  const results = await Promise.all(
    agents.map(async (agent) => {
      const scopedExpectationWhere: Prisma.CommissionExpectationWhereInput = { ...expectationWhere, agentId: agent.id };
      const receivedAgg = await prisma.commissionPayment.aggregate({
        where: {
          ...paymentWhere,
          policy: {
            ...(paymentWhere.policy as object),
            OR: [
              { holder: { assignedAgentId: agent.id } },
              { members: { some: { person: { assignedAgentId: agent.id } } } },
            ],
          },
        },
        _sum: { amount: true },
      });
      const expectationAgg = await prisma.commissionExpectation.aggregate({
        where: scopedExpectationWhere,
        _sum: { expectedAmount: true },
      });
      return {
        agentId: agent.id,
        agentName: agent.name,
        expected: new Prisma.Decimal(expectationAgg._sum.expectedAmount ?? 0),
        received: new Prisma.Decimal(receivedAgg._sum.amount ?? 0),
      };
    })
  );

  return results.filter((r) => !r.expected.isZero() || !r.received.isZero());
}

const BUSINESS_SOURCE_LABELS: Record<string, string> = { OWN: "Propia", REFERRAL: "Referida", UNKNOWN: "Sin clasificar" };

async function getBreakdownByBusinessSource(
  expectationWhere: Prisma.CommissionExpectationWhereInput,
  paymentWhere: Prisma.CommissionPaymentWhereInput
) {
  const sources = ["OWN", "REFERRAL", "UNKNOWN"] as const;
  const results = await Promise.all(
    sources.map(async (source) => {
      const scopedExpectationWhere: Prisma.CommissionExpectationWhereInput = {
        ...expectationWhere,
        policy: { ...(expectationWhere.policy as object), businessSource: source },
      };
      const scopedPaymentWhere: Prisma.CommissionPaymentWhereInput = {
        ...paymentWhere,
        policy: { ...(paymentWhere.policy as object), businessSource: source },
      };
      const [expectationAgg, receivedAgg] = await Promise.all([
        prisma.commissionExpectation.aggregate({ where: scopedExpectationWhere, _sum: { expectedAmount: true } }),
        prisma.commissionPayment.aggregate({ where: scopedPaymentWhere, _sum: { amount: true } }),
      ]);
      return {
        businessSource: source,
        label: BUSINESS_SOURCE_LABELS[source],
        expected: new Prisma.Decimal(expectationAgg._sum.expectedAmount ?? 0),
        received: new Prisma.Decimal(receivedAgg._sum.amount ?? 0),
      };
    })
  );
  return results.filter((r) => !r.expected.isZero() || !r.received.isZero());
}

// Tendencia mensual — si no se seleccionó un período con límites
// definidos ("Todo"), se acota a los últimos 12 meses para no generar
// un desglose potencialmente ilimitado (nunca winning "meses desde el
// origen del negocio" como comportamiento por defecto).
async function getMonthlyTrend(
  expectationWhere: Prisma.CommissionExpectationWhereInput,
  paymentWhere: Prisma.CommissionPaymentWhereInput,
  start: Date | null,
  end: Date | null
) {
  const now = new Date();
  const effectiveEnd = end ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const effectiveStart = start ?? new Date(Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth() - 12, 1));

  const months = enumerateMonths(effectiveStart, effectiveEnd);

  return Promise.all(
    months.map(async ({ year, month, start: monthStart, end: monthEnd }) => {
      const scopedExpectationWhere: Prisma.CommissionExpectationWhereInput = {
        ...expectationWhere,
        period: { gte: monthStart, lt: monthEnd },
      };
      const scopedPaymentWhere: Prisma.CommissionPaymentWhereInput = {
        ...paymentWhere,
        period: { gte: monthStart, lt: monthEnd },
      };
      const [expectationAgg, receivedAgg, assistanceAndNet] = await Promise.all([
        prisma.commissionExpectation.aggregate({ where: scopedExpectationWhere, _sum: { expectedAmount: true } }),
        prisma.commissionPayment.aggregate({ where: scopedPaymentWhere, _sum: { amount: true } }),
        sumAssistanceAndNet(scopedPaymentWhere),
      ]);
      const expected = new Prisma.Decimal(expectationAgg._sum.expectedAmount ?? 0);
      const receivedGross = new Prisma.Decimal(receivedAgg._sum.amount ?? 0);
      return {
        year,
        month,
        label: `${year}-${String(month).padStart(2, "0")}`,
        expected,
        received: receivedGross,
        assistance: assistanceAndNet.assistance,
        net: receivedGross.minus(assistanceAndNet.assistance),
      };
    })
  );
}

// Único indicador que NO se agrega vía SUM/COUNT de la base de datos:
// el "estado de conciliación" es DERIVADO por fila (computeCommissionStatus,
// ya probado en commissions.service.test.ts) a partir de
// expectedAmount y SUM(payments) de ESA fila — no existe una consulta
// SQL de una sola pasada para "cuántas filas caen en cada bucket
// derivado" sin replicar esa lógica en SQL crudo (que introduciría una
// segunda fuente de verdad para la misma regla de negocio). Se cargan
// SOLO las columnas mínimas (status, expectedAmount, payments.amount)
// de TODO el universo filtrado — nunca una página — para mantener la
// exactitud total exigida por el ticket.
async function getReconciliationStatusBreakdown(expectationWhere: Prisma.CommissionExpectationWhereInput) {
  const rows = await prisma.commissionExpectation.findMany({
    where: expectationWhere,
    select: { status: true, expectedAmount: true, payments: { select: { amount: true } } },
  });

  const counts: Record<CommissionDerivedStatus, number> = Object.fromEntries(
    COMMISSION_DERIVED_STATUS_VALUES.map((s) => [s, 0])
  ) as Record<CommissionDerivedStatus, number>;

  for (const row of rows) {
    const received = sumPayments(row.payments);
    const derived = computeCommissionStatus(row.status, row.expectedAmount, received);
    counts[derived] += 1;
  }

  return COMMISSION_DERIVED_STATUS_VALUES.map((status) => ({ status, count: counts[status] })).filter(
    (r) => r.count > 0
  );
}
