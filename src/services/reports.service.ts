import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { parseOrThrow } from "@/services/errors";
import { clientReportQuerySchema } from "@/schemas/reports.schema";
import { getTodayBusinessRange } from "@/lib/business-time";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Reporte operativo de clientes — Fase 021 (§31-§38). Vista de cartera
// para filtrar/exportar; nunca duplica Contact Detail (cada fila
// enlaza ahí, que sigue siendo la fuente de verdad real).
//
// Autorización: MISMA visibilidad abierta ya establecida para
// Contactos desde Fase 008 y reafirmada en la auditoría de Fase 019.9
// (ver docs/DECISIONS.md) — cualquier usuario activo ve cualquier
// contacto en este reporte; el filtro "Agente asignado" es una
// conveniencia de filtrado, no una restricción de autorización.
//
// NUNCA selecciona SSN/USCIS/A-Number/número de documento — solo
// PersonSensitiveIdentity.immigrationCategory (ver
// docs/SENSITIVE_PII.md).
// ---------------------------------------------------------------------------

const EXPIRING_SOON_WINDOW_DAYS = 30;

function buildPolicyFilter(query: {
  hasActivePolicy?: boolean;
  policyType?: string;
  carrierId?: string;
  paymentAssistance?: boolean;
  expiringSoon?: boolean;
}): Prisma.PolicyWhereInput | undefined {
  const conditions: Prisma.PolicyWhereInput = {};
  let hasAny = false;

  if (query.policyType || query.carrierId) {
    conditions.product = {
      ...(query.policyType ? { policyType: query.policyType as Prisma.EnumPolicyTypeFilter["equals"] } : {}),
      ...(query.carrierId ? { carrierId: query.carrierId } : {}),
    };
    hasAny = true;
  }
  if (query.paymentAssistance) {
    conditions.needsPaymentAssistance = true;
    hasAny = true;
  }
  if (query.expiringSoon) {
    const { year, month, day } = getTodayBusinessRange();
    const todayUTC = new Date(Date.UTC(year, month - 1, day));
    const windowEnd = new Date(Date.UTC(year, month - 1, day + EXPIRING_SOON_WINDOW_DAYS));
    conditions.status = { in: ["ACTIVE", "PENDING"] };
    conditions.terminationDate = { gte: todayUTC, lte: windowEnd };
    hasAny = true;
  } else if (query.hasActivePolicy || hasAny) {
    // Si se filtra por tipo/carrier/asistencia sin pedir "vence pronto"
    // explícitamente, se asume que interesan pólizas ACTIVAS (no
    // canceladas/vencidas) — igual que "Has Active Policy" solo.
    conditions.status = "ACTIVE";
  }

  return hasAny || query.hasActivePolicy ? conditions : undefined;
}

export const clientReportSelect = {
  id: true,
  firstName: true,
  lastName: true,
  contactStatus: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  assignedAgent: { select: { id: true, name: true } },
  sensitiveIdentity: { select: { immigrationCategory: true } },
  householdMembers: {
    take: 1,
    select: {
      household: {
        select: {
          id: true,
          city: true,
          state: true,
          county: true,
          zipCode: true,
          annualHouseholdIncome: true,
          _count: { select: { members: true } },
        },
      },
    },
  },
  holderPolicies: {
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      status: true,
      effectiveDate: true,
      terminationDate: true,
      needsPaymentAssistance: true,
      product: { select: { policyType: true, carrier: { select: { name: true } } } },
    },
  },
  _count: {
    select: { holderPolicies: { where: { status: "ACTIVE" } } },
  },
} satisfies Prisma.PersonSelect;

export type ClientReportRow = Prisma.PersonGetPayload<{ select: typeof clientReportSelect }> & {
  lastActivity: { summary: string; createdAt: Date } | null;
};

// Extraída para que exportClientReportCsv (export.service.ts) respete
// EXACTAMENTE los mismos filtros que la vista paginada — nunca dos
// implementaciones del mismo where que puedan divergir.
export function buildClientReportWhere(query: {
  contactStatus?: string;
  assignedAgentId?: string;
  immigrationCategory?: string;
  state?: string;
  city?: string;
  county?: string;
  zipCode?: string;
  hasActivePolicy?: boolean;
  policyType?: string;
  carrierId?: string;
  paymentAssistance?: boolean;
  expiringSoon?: boolean;
  search?: string;
}): Prisma.PersonWhereInput {
  const policyFilter = buildPolicyFilter(query);

  return {
    ...(query.contactStatus ? { contactStatus: query.contactStatus as Prisma.EnumContactStatusFilter["equals"] } : {}),
    ...(query.assignedAgentId ? { assignedAgentId: query.assignedAgentId } : {}),
    ...(query.immigrationCategory
      ? {
          sensitiveIdentity: {
            immigrationCategory: query.immigrationCategory as Prisma.EnumImmigrationCategoryFilter["equals"],
          },
        }
      : {}),
    ...(query.state || query.city || query.county || query.zipCode
      ? {
          householdMembers: {
            some: {
              household: {
                ...(query.state ? { state: query.state } : {}),
                ...(query.city ? { city: { contains: query.city, mode: "insensitive" } } : {}),
                ...(query.county ? { county: { contains: query.county, mode: "insensitive" } } : {}),
                ...(query.zipCode ? { zipCode: query.zipCode } : {}),
              },
            },
          },
        }
      : {}),
    ...(policyFilter ? { holderPolicies: { some: policyFilter } } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: "insensitive" } },
            { lastName: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listClientReport(actor: AuthorizedUser, rawQuery: unknown) {
  void actor;
  const query = parseOrThrow(clientReportQuerySchema, rawQuery);
  const where = buildClientReportWhere(query);

  const [items, total] = await Promise.all([
    prisma.person.findMany({
      where,
      select: clientReportSelect,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.person.count({ where }),
  ]);

  // Última actividad por contacto, en un solo query batch (distinct on
  // contactPersonId) en vez de N llamadas — solo para la página actual,
  // nunca para toda la cartera.
  const ids = items.map((p) => p.id);
  const latestEvents =
    ids.length > 0
      ? await prisma.auditEvent.findMany({
          where: { contactPersonId: { in: ids } },
          distinct: ["contactPersonId"],
          orderBy: [{ contactPersonId: "asc" }, { createdAt: "desc" }],
          select: { contactPersonId: true, summary: true, createdAt: true },
        })
      : [];
  const lastActivityByPersonId = new Map(
    latestEvents.map((e) => [e.contactPersonId as string, { summary: e.summary, createdAt: e.createdAt }])
  );

  const rows: ClientReportRow[] = items.map((p) => ({
    ...p,
    lastActivity: lastActivityByPersonId.get(p.id) ?? null,
  }));

  return { items: rows, total, page: query.page, pageSize: query.pageSize };
}
