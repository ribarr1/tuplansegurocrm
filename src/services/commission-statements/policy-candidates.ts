import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import { inferPeriod } from "./matcher";
import type { NormalizedCommissionRow } from "./types";

// ---------------------------------------------------------------------------
// Fase 025.5.6 (UAT-22) — servicio ÚNICO de búsqueda de candidatas para
// emparejar una fila del reporte con una Policy (y, para Orange
// Referidas, un PolicyMember). Antes de esta fase, la ventana de
// emparejamiento solo mostraba nombre+carrier, insuficiente cuando una
// persona tiene varias pólizas (años distintos, renovaciones, carriers
// repetidos) — el ADMIN podía seleccionar accidentalmente una póliza de
// un año equivocado. Este módulo es la ÚNICA fuente de la lógica de
// enriquecimiento/priorización; tanto el server action de búsqueda como
// la validación al confirmar (reconciliation.service.ts) importan de
// aquí, nunca duplican la lógica.
// ---------------------------------------------------------------------------

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede realizar esta acción.");
  }
}

// Mismo esquema de enmascarado que maskExternalId en reconciliation.service.ts
// (últimos 4 caracteres visibles) — nunca se expone un número de póliza
// completo en esta ventana.
export function maskPolicyNumber(policyNumber: string | null): string | null {
  if (!policyNumber) return null;
  if (policyNumber.length <= 4) return "*".repeat(policyNumber.length);
  return `${"*".repeat(policyNumber.length - 4)}${policyNumber.slice(-4)}`;
}

export type PeriodMatch = "MATCH" | "OUT_OF_PERIOD" | "INCOMPLETE";

// Fecha-solo (@db.Date, sin componente de hora) — se compara SIEMPRE
// por año/mes en UTC, igual que inferPeriod: estas columnas ya están
// ancladas a medianoche UTC, así que usar getters UTC es lo que evita
// el desplazamiento por zona horaria (nunca se reinterpretan con la
// zona horaria local del proceso, ver docs/DECISIONS.md). No hay
// componente de hora que convertir a APP_TIME_ZONE aquí — a diferencia
// de un timestamp real (ej. uploadedAt), una fecha DATE no tiene "hora
// de pared" que ubicar en una zona.
function monthStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

// period = primer día del mes de comisión (ya normalizado por
// inferPeriod). Vigencia: desde effectiveDate inclusive, hasta
// terminationDate inclusive (mes completo) — sin terminationDate se
// asume cobertura abierta hacia adelante (misma semántica que el resto
// del dominio para una póliza sin fecha de baja, nunca se inventa una).
export function computePeriodMatch(
  period: Date | null,
  effectiveDate: Date | null,
  terminationDate: Date | null
): PeriodMatch {
  if (!period || !effectiveDate) return "INCOMPLETE";
  const periodMonth = monthStart(period);
  const startMonth = monthStart(effectiveDate);
  if (periodMonth < startMonth) return "OUT_OF_PERIOD";
  if (terminationDate) {
    const endMonth = monthStart(terminationDate);
    if (periodMonth > endMonth) return "OUT_OF_PERIOD";
  }
  return "MATCH";
}

export type PolicyMemberCandidate = {
  id: string;
  role: string;
  displayName: string;
  // true si OTRA fila (de cualquier statement, no ignorada/duplicada)
  // ya está vinculada a este miembro para el MISMO período — nunca se
  // vincula en silencio dos filas al mismo miembro/mes (ver UAT-22,
  // "ORANGE REFERIDAS POR MIEMBRO").
  possibleDuplicate: boolean;
};

export type PolicyCandidate = {
  policyId: string;
  holderName: string;
  carrierName: string;
  productName: string;
  planYear: number | null;
  effectiveDate: Date | null;
  terminationDate: Date | null;
  status: string;
  businessSource: string;
  maskedPolicyNumber: string | null;
  periodMatch: PeriodMatch;
  modalityMatches: boolean;
  policyTypeMatches: boolean;
  // Recomendada = coincide en período, modalidad y tipo de póliza —
  // nunca se recomienda solo por nombre.
  recommended: boolean;
  warnings: string[];
  // Solo para Orange Referidas (payerAgency=ORANGE && businessModality=REFERRAL)
  policyMembers: PolicyMemberCandidate[] | null;
};

const ROLE_LABELS: Record<string, string> = {
  PRIMARY: "Titular",
  SPOUSE: "Cónyuge",
  DEPENDENT: "Dependiente",
  OTHER: "Otro miembro",
};

export async function searchPolicyCandidatesForRow(
  actor: AuthorizedUser,
  rawRowId: unknown,
  search: string
): Promise<PolicyCandidate[]> {
  assertAdminOnly(actor);
  if (!search || search.trim().length < 2) return [];
  const rowId = typeof rawRowId === "string" ? rawRowId : "";
  if (!rowId) return [];

  const row = await prisma.commissionStatementRow.findUnique({
    where: { id: rowId },
    select: {
      effectiveDate: true,
      paidAt: true,
      metadata: true,
      statement: {
        select: { payerAgency: true, businessModality: true, detectedCarrierName: true },
      },
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Fila no encontrada.");
  const rowState = (row.metadata as { state?: string | null } | null)?.state ?? null;

  const period = inferPeriod({
    source: "",
    receivedAmount: "0",
    sourceRowNumber: 0,
    paidAt: row.paidAt,
    effectiveDate: row.effectiveDate,
  } as NormalizedCommissionRow);

  const requiresHealthOnly = row.statement.payerAgency !== null; // los 3 adapters PDF son exclusivamente HEALTH
  const businessModality = row.statement.businessModality;
  const isOrangeReferral = row.statement.payerAgency === "ORANGE" && businessModality === "REFERRAL";

  const candidates = await prisma.policy.findMany({
    where: {
      OR: [
        { holder: { firstName: { contains: search, mode: "insensitive" } } },
        { holder: { lastName: { contains: search, mode: "insensitive" } } },
        { policyNumber: { contains: search, mode: "insensitive" } },
        // También busca por miembros del hogar (cónyuge/dependiente) —
        // Orange Referidas paga por miembro, nunca solo por el titular.
        { members: { some: { person: { firstName: { contains: search, mode: "insensitive" } } } } },
        { members: { some: { person: { lastName: { contains: search, mode: "insensitive" } } } } },
      ],
      ...(requiresHealthOnly ? { product: { policyType: "HEALTH" } } : {}),
    },
    select: {
      id: true,
      policyNumber: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      businessSource: true,
      holder: { select: { firstName: true, lastName: true } },
      household: { select: { state: true } },
      product: { select: { name: true, planYear: true, policyType: true, carrier: { select: { name: true } } } },
      members: {
        select: { id: true, role: true, person: { select: { firstName: true, lastName: true } } },
      },
    },
    take: 15,
  });

  // Duplicado potencial de miembro/período: cualquier OTRA fila (no
  // ignorada/duplicada) ya vinculada a un PolicyMember de estas
  // candidatas, con el mismo período — se calcula una sola vez para
  // todos los policyMemberId candidatos.
  const allMemberIds = candidates.flatMap((c) => c.members.map((m) => m.id));
  const existingLinks =
    isOrangeReferral && period && allMemberIds.length > 0
      ? await prisma.commissionStatementRow.findMany({
          where: {
            matchedPolicyMemberId: { in: allMemberIds },
            matchStatus: { in: ["MATCHED", "APPLIED"] },
          },
          select: { matchedPolicyMemberId: true, paidAt: true, effectiveDate: true },
        })
      : [];
  const linkedMemberIdsForPeriod = new Set(
    existingLinks
      .filter((l) => {
        const linkPeriod = inferPeriod({
          source: "",
          receivedAmount: "0",
          sourceRowNumber: 0,
          paidAt: l.paidAt,
          effectiveDate: l.effectiveDate,
        } as NormalizedCommissionRow);
        return linkPeriod && period && linkPeriod.getTime() === period.getTime();
      })
      .map((l) => l.matchedPolicyMemberId)
  );

  const enriched: PolicyCandidate[] = candidates.map((c) => {
    const periodMatch = computePeriodMatch(period, c.effectiveDate, c.terminationDate);
    const modalityMatches = !businessModality || c.businessSource === businessModality;
    const policyTypeMatches = !requiresHealthOnly || c.product.policyType === "HEALTH";
    const carrierMatches =
      !row.statement.detectedCarrierName ||
      c.product.carrier.name.trim().toLowerCase() === row.statement.detectedCarrierName.trim().toLowerCase();
    const geoMatches = !rowState || !c.household?.state || c.household.state === rowState;

    const warnings: string[] = [];
    if (periodMatch === "OUT_OF_PERIOD") warnings.push("Fuera del periodo de comisión.");
    if (periodMatch === "INCOMPLETE") warnings.push("Vigencia incompleta — no se puede verificar el periodo.");
    if (!modalityMatches) {
      warnings.push(
        `Modalidad no coincide (reporte ${businessModality === "OWN" ? "propias" : "referidas"}, póliza ${c.businessSource === "UNKNOWN" ? "sin clasificar" : c.businessSource === "OWN" ? "propia" : "referida"}).`
      );
    }
    if (c.businessSource === "UNKNOWN") warnings.push("Clasificación histórica sin definir (UNKNOWN).");
    if (!policyTypeMatches) warnings.push("Esta póliza no es de tipo HEALTH.");
    if (!carrierMatches) warnings.push("El carrier detectado en el reporte no coincide con el de esta póliza.");
    if (!geoMatches) warnings.push("El estado geográfico no coincide con el del reporte.");

    return {
      policyId: c.id,
      holderName: `${c.holder.firstName} ${c.holder.lastName}`,
      carrierName: c.product.carrier.name,
      productName: c.product.name,
      planYear: c.product.planYear,
      effectiveDate: c.effectiveDate,
      terminationDate: c.terminationDate,
      status: c.status,
      businessSource: c.businessSource,
      maskedPolicyNumber: maskPolicyNumber(c.policyNumber),
      periodMatch,
      modalityMatches,
      policyTypeMatches,
      recommended: periodMatch === "MATCH" && modalityMatches && policyTypeMatches && carrierMatches && geoMatches,
      warnings,
      policyMembers: isOrangeReferral
        ? c.members.map((m) => ({
            id: m.id,
            role: ROLE_LABELS[m.role] ?? m.role,
            displayName: `${m.person.firstName} ${m.person.lastName}`,
            possibleDuplicate: linkedMemberIdsForPeriod.has(m.id),
          }))
        : null,
    };
  });

  // Recomendadas primero; dentro de cada grupo, coincidencia de
  // período antes que el resto — nunca el nombre como único criterio
  // de orden.
  return enriched.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const rank = (p: PeriodMatch) => (p === "MATCH" ? 0 : p === "INCOMPLETE" ? 1 : 2);
    return rank(a.periodMatch) - rank(b.periodMatch);
  });
}
