import "server-only";
import { prisma } from "@/lib/prisma";
import type { NormalizedCommissionRow } from "./types";

// ---------------------------------------------------------------------------
// Motor de matching — Fase 020 (§15). Conservador por diseño: solo
// confirma un match automático cuando la evidencia es fuerte
// (identificador externo ya vinculado, o exactamente un candidato por
// nombre+carrier). Nunca confirma por nombre solo, y nunca confirma
// cuando hay ambigüedad — esas filas quedan AMBIGUOUS/UNMATCHED para
// revisión manual (ver reconciliation.service.ts::manualMatchRow).
// ---------------------------------------------------------------------------

export type MatchResult =
  | { status: "MATCHED"; policyId: string; expectationId: string | null }
  | { status: "UNMATCHED" }
  | { status: "AMBIGUOUS"; candidatePolicyIds: string[] };

// El período de la expectativa NUNCA se asume igual a effectiveDate —
// se deriva del mes de paidAt cuando existe (es la fecha real del pago
// que estamos conciliando), con effectiveDate solo como fallback si el
// adapter no trae paidAt (ver §23 de la ficha).
function inferPeriod(row: NormalizedCommissionRow): Date | null {
  const source = row.paidAt ?? row.effectiveDate;
  if (!source) return null;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), 1));
}

async function findExpectationForPolicy(
  policyId: string,
  row: NormalizedCommissionRow
): Promise<string | null> {
  const period = inferPeriod(row);
  if (!period) return null;
  const expectation = await prisma.commissionExpectation.findUnique({
    where: { policyId_period: { policyId, period } },
    select: { id: true },
  });
  return expectation?.id ?? null;
}

export async function matchStatementRow(source: string, row: NormalizedCommissionRow): Promise<MatchResult> {
  // 1. Identificador externo ya vinculado explícitamente a una Policy
  // (por un match manual anterior, ver §16) — la señal más fuerte
  // posible, nunca se vuelve a preguntar.
  if (row.externalMemberId) {
    const ref = await prisma.policyExternalReference.findUnique({
      where: {
        source_type_externalId: { source, type: "MEMBER_ID", externalId: row.externalMemberId },
      },
      select: { policyId: true },
    });
    if (ref) {
      const expectationId = await findExpectationForPolicy(ref.policyId, row);
      return { status: "MATCHED", policyId: ref.policyId, expectationId };
    }
  }

  // 2. policyNumber exacto — motor genérico para un futuro adapter que
  // sí reporte el número de póliza real (Orange/Oscar no lo hace: su
  // "Member ID" nunca se asume igual a policyNumber, ver
  // docs/COMMISSION_RECONCILIATION.md).
  if (row.externalMemberId) {
    const byNumber = await prisma.policy.findFirst({
      where: { policyNumber: row.externalMemberId },
      select: { id: true },
    });
    if (byNumber) {
      const expectationId = await findExpectationForPolicy(byNumber.id, row);
      return { status: "MATCHED", policyId: byNumber.id, expectationId };
    }
  }

  // 3. Titular (nombre completo exacto, insensible a mayúsculas) +
  // carrier — candidatos fuertes, nunca solo nombre. Auto-confirma
  // SOLO si hay exactamente un candidato; 2+ quedan AMBIGUOUS.
  if (row.memberName && row.memberName.trim().split(/\s+/).length >= 2) {
    const fullNameLower = row.memberName.trim().toLowerCase().replace(/\s+/g, " ");
    const candidates = await prisma.policy.findMany({
      where: row.carrier
        ? { product: { carrier: { name: { equals: row.carrier, mode: "insensitive" } } } }
        : {},
      select: { id: true, holder: { select: { firstName: true, lastName: true } } },
    });
    const matched = candidates.filter(
      (c) =>
        `${c.holder.firstName} ${c.holder.lastName}`.trim().toLowerCase().replace(/\s+/g, " ") ===
        fullNameLower
    );
    if (matched.length === 1) {
      const expectationId = await findExpectationForPolicy(matched[0].id, row);
      return { status: "MATCHED", policyId: matched[0].id, expectationId };
    }
    if (matched.length > 1) {
      return { status: "AMBIGUOUS", candidatePolicyIds: matched.map((m) => m.id) };
    }
  }

  return { status: "UNMATCHED" };
}

// Reutilizada por manualMatchRow — expuesta para no duplicar la lógica
// de inferencia de período.
export { inferPeriod, findExpectationForPolicy };
