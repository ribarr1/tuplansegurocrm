import type { ImportPlan } from "./types";
import type { ApplyResult } from "./apply-plan";

// Reporte de import SIN PII — Fase 023 §41. Nunca incluye nombres,
// emails, teléfonos, SSN, USCIS ni direcciones completas; solo counts,
// códigos de advertencia/bloqueo y el INDEX de origen (trazabilidad,
// no identifica a la persona por sí solo fuera del CSV original que
// nunca se commitea).

export type ImportReport = {
  generatedAt: string;
  mode: "dry-run" | "apply";
  sourceRows: number;
  rowsImported: number;
  rowsSkipped: number;
  personsCreated: number;
  personsMatched: number;
  householdsCreated: number;
  policiesCreated: number;
  policyMembersCreated: number;
  carriersCreated: number;
  productsCreated: number;
  sensitiveIdentitiesImportedCount: number;
  uscisImportedCount: number;
  notesImported: number;
  warnings: { sourceIndex: string; code: string; message: string }[];
  blockingErrors: { sourceIndex: string; code: string; message: string }[];
  statusCounts: Record<string, number>;
  carrierCounts: Record<string, number>;
  sexCounts: { MALE: number; FEMALE: number; OTHER: number; UNKNOWN: number };
  healthPolicies2025NormalizedToCancelled: number;
  productsByPolicyType: Record<string, number>;
};

export function buildImportReport(plan: ImportPlan, applyResult: ApplyResult | null): ImportReport {
  const statusCounts: Record<string, number> = {};
  const carrierCounts: Record<string, number> = {};
  for (const p of plan.policies) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
    carrierCounts[p.carrierName] = (carrierCounts[p.carrierName] ?? 0) + 1;
  }

  const warnings = plan.issues
    .filter((i) => i.severity === "WARNING")
    .map((i) => ({ sourceIndex: i.sourceIndex, code: i.code, message: i.message }));
  const blockingErrors = plan.issues
    .filter((i) => i.severity === "BLOCKING")
    .map((i) => ({ sourceIndex: i.sourceIndex, code: i.code, message: i.message }));

  if (applyResult) {
    for (const b of applyResult.overlapBlocked) {
      warnings.push({ sourceIndex: b.sourceIndex, code: "HEALTH_COVERAGE_OVERLAP_BLOCKED_ON_APPLY", message: b.reason });
    }
  }

  return {
    generatedAt: plan.generatedAt,
    mode: applyResult ? "apply" : "dry-run",
    sourceRows: plan.counts.sourceRows,
    rowsImported: plan.policies.length - (applyResult?.policiesSkippedOverlap ?? 0),
    rowsSkipped: plan.counts.rowsSkipped + (applyResult?.policiesSkippedOverlap ?? 0),
    personsCreated: applyResult ? applyResult.personsCreated : plan.counts.personsNew,
    personsMatched: applyResult ? applyResult.personsMatched : plan.counts.personsMatched,
    householdsCreated: applyResult ? applyResult.householdsCreated : plan.counts.householdsNew,
    policiesCreated: applyResult ? applyResult.policiesCreated : plan.counts.policiesToCreate,
    policyMembersCreated: applyResult ? applyResult.policyMembersCreated : plan.counts.policyMembersToCreate,
    carriersCreated: applyResult ? applyResult.carriersCreated : plan.counts.carriersNeeded,
    productsCreated: applyResult ? applyResult.productsCreated : plan.counts.productsNeeded,
    sensitiveIdentitiesImportedCount: applyResult
      ? applyResult.sensitiveIdentitiesImported
      : plan.counts.sensitiveIdentitiesToImport,
    uscisImportedCount: applyResult ? applyResult.uscisImported : plan.counts.uscisToImport,
    notesImported: applyResult ? applyResult.notesImported : plan.counts.notesToImport,
    warnings,
    blockingErrors,
    statusCounts,
    carrierCounts,
    sexCounts: plan.counts.sex,
    healthPolicies2025NormalizedToCancelled: plan.counts.healthPolicies2025NormalizedToCancelled,
    productsByPolicyType: plan.counts.productsByPolicyType,
  };
}
