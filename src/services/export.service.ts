import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import { recordAuditEvent } from "@/services/audit.service";
import { policyAgentAccessWhere, buildPolicyFilterWhere } from "@/services/policies.service";
import { buildPersonFilterWhere } from "@/services/people.service";
import { listPoliciesQuerySchema } from "@/schemas/policy.schema";
import { listPeopleQuerySchema } from "@/schemas/person.schema";
import { parseOrThrow } from "@/services/errors";
import { agentCommissionAccessWhere, sumPayments } from "@/services/commissions.service";
import { toCsv } from "@/lib/csv";
import { formatDateOnlyUS } from "@/lib/date-only";
import { clientReportQuerySchema } from "@/schemas/reports.schema";
import { buildClientReportWhere, clientReportSelect } from "@/services/reports.service";
import {
  IMMIGRATION_CATEGORY_LABELS,
  POLICY_TYPE_LABELS,
  POLICY_BUSINESS_SOURCE_LABELS,
  paymentModeShowsAssistanceBadge,
} from "@/lib/labels";

// ---------------------------------------------------------------------------
// Exportación CSV — Fase 020 (§1 de la ficha).
//
// Reutiliza exactamente la autorización ya establecida de cada módulo
// (nunca una regla nueva y paralela): Contactos usa la visibilidad
// abierta ya existente (Fase 008, confirmada en la auditoría de Fase
// 019.9 — ver docs/DECISIONS.md), Pólizas usa policyAgentAccessWhere,
// Comisiones usa assertModuleAccess (ASSISTANT FORBIDDEN) +
// agentCommissionAccessWhere.
//
// NUNCA se exportan: SSN, datos bancarios/tarjeta, credenciales,
// información médica (medicamentos/proveedores), contenido de
// documentos, ni el detalle de `AuditEvent.changes`. Los campos
// exportados son deliberadamente un subconjunto explícito (allowlist),
// nunca "todas las columnas del modelo".
//
// Tope de 5000 filas por exportación — generoso para el volumen de una
// sola agencia en V1, evita una exportación sin límite que pudiera
// agotar memoria. Documentado, no oculto.
// ---------------------------------------------------------------------------

const EXPORT_ROW_LIMIT = 5000;

// Fase 025.5.1 (UAT-11): acepta los MISMOS filtros que el listado de
// /contacts (search, contactStatus, assignedAgentId — reutilizando
// buildPersonFilterWhere, nunca duplicados), mismo patrón que
// exportPoliciesCsv (Fase 025.5, UAT-09). rawFilters es opcional: sin
// filtros exporta el universo completo autorizado, igual que antes.
// Deliberadamente NO acepta el filtro de reseña de Google — esa
// información administrativa nunca se mezcla en este export general
// (ver UAT-10: exclusivamente ADMIN, y ni siquiera para ADMIN se anexa
// aquí para no cambiar el contrato de "contactos.csv" sin pedirlo).
export async function exportContactsCsv(actor: AuthorizedUser, rawFilters?: unknown): Promise<string> {
  const parsed = rawFilters ? parseOrThrow(listPeopleQuerySchema, rawFilters) : undefined;
  const where = parsed ? buildPersonFilterWhere(parsed) : undefined;

  const people = await prisma.person.findMany({
    where,
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      contactStatus: true,
      assignedAgent: { select: { name: true } },
      createdAt: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: EXPORT_ROW_LIMIT,
  });

  const csv = toCsv(
    ["Nombre", "Apellido", "Teléfono", "Email", "Estado", "Agente asignado", "Creado"],
    people.map((p) => [
      p.firstName,
      p.lastName,
      p.phone,
      p.email,
      p.contactStatus,
      p.assignedAgent?.name ?? "",
      formatDateOnlyUS(p.createdAt),
    ])
  );

  await recordAuditEvent(prisma, {
    actor,
    entityType: "Export",
    entityId: randomUUID(),
    action: "EXPORT_CONTACTS",
    summary: `Exportación CSV de Contactos (${people.length} filas)`,
    metadata: { rowCount: people.length },
  });

  return csv;
}

// Fase 025.5 (UAT-09): acepta los MISMOS filtros que el listado de
// /policies (reutilizando buildPolicyFilterWhere, nunca duplicados) —
// "Exportar CSV" ahora exporta exactamente lo que la pantalla está
// mostrando, incluido el filtro por agente (Policy.processedById).
// rawFilters es opcional: sin filtros, exporta el alcance completo
// autorizado, igual que antes de esta fase.
export async function exportPoliciesCsv(actor: AuthorizedUser, rawFilters?: unknown): Promise<string> {
  const parsed = rawFilters ? parseOrThrow(listPoliciesQuerySchema, rawFilters) : undefined;
  const filterWhere = parsed ? buildPolicyFilterWhere(parsed) : undefined;
  const agentWhere = policyAgentAccessWhere(actor);
  const where: Prisma.PolicyWhereInput | undefined =
    filterWhere && agentWhere
      ? { AND: [filterWhere, agentWhere] }
      : (filterWhere ?? agentWhere ?? undefined);

  const policies = await prisma.policy.findMany({
    where,
    select: {
      policyNumber: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      premiumAmount: true,
      billingFrequency: true,
      paymentStatus: true,
      // Fase 025.3 (Bloque B): valor histórico ya almacenado — nunca se
      // recalcula para el export (ver policy-business-source.service.ts).
      businessSource: true,
      holder: { select: { firstName: true, lastName: true } },
      product: { select: { name: true, policyType: true, carrier: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT,
  });

  const csv = toCsv(
    [
      "Número de póliza",
      "Titular",
      "Tipo",
      "Compañía",
      "Producto",
      "Estado",
      "Fecha efectiva",
      "Fecha de terminación",
      "Prima",
      "Frecuencia",
      "Estado de pago",
      "Propia/Referida",
    ],
    policies.map((p) => [
      p.policyNumber,
      `${p.holder.firstName} ${p.holder.lastName}`,
      p.product.policyType,
      p.product.carrier.name,
      p.product.name,
      p.status,
      formatDateOnlyUS(p.effectiveDate),
      formatDateOnlyUS(p.terminationDate),
      p.premiumAmount ? p.premiumAmount.toString() : "",
      p.billingFrequency ?? "",
      p.paymentStatus ?? "",
      POLICY_BUSINESS_SOURCE_LABELS[p.businessSource],
    ])
  );

  await recordAuditEvent(prisma, {
    actor,
    entityType: "Export",
    entityId: randomUUID(),
    action: "EXPORT_POLICIES",
    summary: `Exportación CSV de Pólizas (${policies.length} filas)`,
    metadata: { rowCount: policies.length },
  });

  return csv;
}

export async function exportCommissionsCsv(actor: AuthorizedUser): Promise<string> {
  if (actor.role === "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes acceso al módulo de comisiones.");
  }

  const agentWhere = agentCommissionAccessWhere(actor);
  const expectations = await prisma.commissionExpectation.findMany({
    where: agentWhere ?? undefined,
    select: {
      period: true,
      expectedAmount: true,
      status: true,
      policy: {
        select: {
          policyNumber: true,
          holder: { select: { firstName: true, lastName: true } },
          product: { select: { carrier: { select: { name: true } } } },
        },
      },
      payments: { select: { amount: true } },
    },
    orderBy: { period: "desc" },
    take: EXPORT_ROW_LIMIT,
  });

  // Fase 025.4 (UAT-06): fila de totales al final, sumando exactamente
  // las filas incluidas en ESTE export (nunca una consulta de
  // agregación aparte que pudiera desalinearse) — mismo signo que la
  // columna "Diferencia" de cada fila (Recibido - Esperado) para no
  // introducir dos convenciones distintas dentro del mismo archivo.
  let totalExpected = new Prisma.Decimal(0);
  let totalReceived = new Prisma.Decimal(0);
  const rows = expectations.map((e) => {
    const received = sumPayments(e.payments);
    const difference = received.minus(e.expectedAmount);
    totalExpected = totalExpected.plus(e.expectedAmount);
    totalReceived = totalReceived.plus(received);
    return [
      `${e.period.getUTCFullYear()}-${String(e.period.getUTCMonth() + 1).padStart(2, "0")}`,
      `${e.policy.holder.firstName} ${e.policy.holder.lastName}`,
      e.policy.policyNumber,
      e.policy.product.carrier.name,
      e.expectedAmount.toString(),
      received.toString(),
      difference.toString(),
      e.status,
    ];
  });
  rows.push([
    "TOTAL",
    "",
    "",
    "",
    totalExpected.toString(),
    totalReceived.toString(),
    totalReceived.minus(totalExpected).toString(),
    expectations.length >= EXPORT_ROW_LIMIT ? "TRUNCADO" : "",
  ]);

  const csv = toCsv(
    ["Período", "Titular", "Póliza", "Compañía", "Esperado", "Recibido", "Diferencia", "Estado"],
    rows
  );

  await recordAuditEvent(prisma, {
    actor,
    entityType: "Export",
    entityId: randomUUID(),
    action: "EXPORT_COMMISSIONS",
    summary: `Exportación CSV de Comisiones (${expectations.length} filas)`,
    metadata: { rowCount: expectations.length },
  });

  return csv;
}

// Reporte de clientes (Fase 021, §37) — respeta EXACTAMENTE los mismos
// filtros que /reports/clients (buildClientReportWhere compartido, ver
// reports.service.ts) y la misma visibilidad abierta de Contactos.
// NUNCA exporta SSN/USCIS/A-Number/número de documento — solo
// Immigration Category (no un identificador, ver docs/SENSITIVE_PII.md).
export async function exportClientReportCsv(actor: AuthorizedUser, rawQuery: unknown): Promise<string> {
  const query = clientReportQuerySchema.parse(rawQuery ?? {});
  const where = buildClientReportWhere(query);

  const people = await prisma.person.findMany({
    where,
    select: clientReportSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: EXPORT_ROW_LIMIT,
  });

  const csv = toCsv(
    [
      "Nombre",
      "Estado",
      "Agente",
      "Ciudad",
      "Estado (US)",
      "Categoría migratoria",
      "Miembros del hogar",
      "Ingreso familiar anual",
      "Pólizas activas",
      "Compañía principal",
      "Tipo de póliza",
      "Fecha efectiva",
      "Fecha de terminación",
      "Asistencia de pago",
    ],
    people.map((p) => {
      const household = p.householdMembers[0]?.household;
      const primaryPolicy = p.holderPolicies[0];
      return [
        `${p.firstName} ${p.lastName}`,
        p.contactStatus,
        p.assignedAgent?.name ?? "",
        household?.city ?? "",
        household?.state ?? "",
        IMMIGRATION_CATEGORY_LABELS[p.sensitiveIdentity?.immigrationCategory ?? "UNKNOWN"],
        household ? String(household._count.members) : "",
        household?.annualHouseholdIncome ? household.annualHouseholdIncome.toString() : "",
        String(p._count.holderPolicies),
        primaryPolicy?.product.carrier.name ?? "",
        primaryPolicy ? POLICY_TYPE_LABELS[primaryPolicy.product.policyType] : "",
        formatDateOnlyUS(primaryPolicy?.effectiveDate),
        formatDateOnlyUS(primaryPolicy?.terminationDate),
        primaryPolicy && paymentModeShowsAssistanceBadge(primaryPolicy.paymentManagementMode) ? "Sí" : "",
      ];
    })
  );

  await recordAuditEvent(prisma, {
    actor,
    entityType: "Export",
    entityId: randomUUID(),
    action: "EXPORT_CLIENT_REPORT",
    summary: `Exportación CSV de Reporte de clientes (${people.length} filas)`,
    metadata: { rowCount: people.length },
  });

  return csv;
}
