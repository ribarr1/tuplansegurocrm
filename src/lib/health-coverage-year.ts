// Fase 025.2 (incidente de datos real — falso terminationDate 2026 en
// una póliza con effectiveDate 2027): helper CENTRAL para resolver el
// "año de cobertura" real de una póliza HEALTH — create/update/renew
// (policies.service.ts) e import (build-plan.ts) deben usar
// EXACTAMENTE esta misma lógica, nunca una copia local.
//
// Módulo sin "server-only" a propósito: build-plan.ts corre también
// como parte de scripts/import-book-of-business.ts (fuera del árbol
// de Next, ver docs/DECISIONS.md sobre pii-crypto-core.ts) y no puede
// tolerar el guard.
//
// ROOT CAUSE del incidente real: una renovación (previousPolicyId)
// reutilizó el MISMO Product que su predecesora (planYear=2026)
// aunque su propia effectiveDate ya era 2027-01-01 — el código
// anterior usaba Product.planYear con prioridad ciega sobre
// effectiveDate, produciendo terminationDate=2026-12-31 CON
// effectiveDate=2027-01-01 (terminación antes que el inicio). El
// Product de catálogo puede quedar desalineado del año real de una
// póliza específica cuando una renovación no crea/selecciona un
// Product nuevo — effectiveDate es siempre el hecho más específico y
// confiable de ESA póliza, nunca se sobrescribe por un dato de
// catálogo compartido.
export type HealthCoverageYearResult = {
  year: number | null;
  source: "planYear" | "effectiveDate" | "none";
  // true cuando Product.planYear y el año de effectiveDate estaban
  // presentes pero EN DESACUERDO — nunca se elige uno "porque sí": se
  // prioriza effectiveDate (específico de la póliza) y se marca el
  // conflicto para que el caller pueda reportarlo/loguearlo, nunca se
  // descarta en silencio.
  conflict: boolean;
};

export function resolveHealthCoverageYear(
  planYear: number | null,
  effectiveDate: Date | null
): HealthCoverageYearResult {
  const effectiveYear = effectiveDate ? effectiveDate.getUTCFullYear() : null;

  if (planYear != null && effectiveYear != null) {
    if (planYear === effectiveYear) {
      return { year: planYear, source: "planYear", conflict: false };
    }
    return { year: effectiveYear, source: "effectiveDate", conflict: true };
  }
  if (planYear != null) return { year: planYear, source: "planYear", conflict: false };
  if (effectiveYear != null) return { year: effectiveYear, source: "effectiveDate", conflict: false };
  return { year: null, source: "none", conflict: false };
}

// Default de terminationDate para HEALTH: 31/12 del año de cobertura
// resuelto — nunca el año del servidor, nunca heredado de la
// predecesora de una renovación (cada Policy resuelve el suyo propio
// a partir de SU PROPIA effectiveDate, nunca de previousPolicyId).
export function healthDefaultTerminationDate(
  policyType: string,
  planYear: number | null,
  effectiveDate: Date | null
): Date | null {
  if (policyType !== "HEALTH") return null;
  const { year } = resolveHealthCoverageYear(planYear, effectiveDate);
  if (year == null) return null;
  return new Date(Date.UTC(year, 11, 31));
}
