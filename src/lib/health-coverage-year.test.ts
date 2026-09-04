import { describe, it, expect } from "vitest";
import { resolveHealthCoverageYear, healthDefaultTerminationDate } from "@/lib/health-coverage-year";

// Fase 025.2 (incidente de datos real): helper central para el "año de
// cobertura" de una póliza HEALTH — root cause del bug real fue usar
// Product.planYear con prioridad ciega sobre effectiveDate cuando una
// renovación reutilizaba el mismo Product que su predecesora.
describe("health-coverage-year — resolveHealthCoverageYear / healthDefaultTerminationDate", () => {
  it("1) effectiveDate 01/01/2027 sin planYear conflictivo -> termination 12/31/2027", () => {
    const result = healthDefaultTerminationDate("HEALTH", 2027, new Date(Date.UTC(2027, 0, 1)));
    expect(result?.toISOString().slice(0, 10)).toBe("2027-12-31");
  });

  it("2) planYear desalineado (renovación con Product reutilizado) NUNCA hereda el año de la predecesora — prioriza effectiveDate", () => {
    // Simula exactamente el incidente real: Product.planYear=2026
    // (reutilizado de la predecesora) pero esta póliza específica ya
    // tiene effectiveDate=2027-01-01.
    const result = resolveHealthCoverageYear(2026, new Date(Date.UTC(2027, 0, 1)));
    expect(result.year).toBe(2027);
    expect(result.source).toBe("effectiveDate");
    expect(result.conflict).toBe(true);

    const termination = healthDefaultTerminationDate("HEALTH", 2026, new Date(Date.UTC(2027, 0, 1)));
    expect(termination?.toISOString().slice(0, 10)).toBe("2027-12-31");
    // Nunca termination < effectiveDate.
    expect(termination!.getTime()).toBeGreaterThan(new Date(Date.UTC(2027, 0, 1)).getTime());
  });

  it("3) planYear/effectiveDate en conflicto se marca explícitamente (nunca se elige en silencio)", () => {
    const result = resolveHealthCoverageYear(2025, new Date(Date.UTC(2026, 5, 1)));
    expect(result.conflict).toBe(true);
    expect(result.year).toBe(2026);
  });

  it("planYear y effectiveDate coinciden -> sin conflicto, usa planYear", () => {
    const result = resolveHealthCoverageYear(2026, new Date(Date.UTC(2026, 3, 1)));
    expect(result.conflict).toBe(false);
    expect(result.year).toBe(2026);
    expect(result.source).toBe("planYear");
  });

  it("sin planYear, cae a effectiveDate sin marcar conflicto", () => {
    const result = resolveHealthCoverageYear(null, new Date(Date.UTC(2026, 3, 1)));
    expect(result.conflict).toBe(false);
    expect(result.year).toBe(2026);
    expect(result.source).toBe("effectiveDate");
  });

  it("sin planYear ni effectiveDate -> year null, nunca inventa el año del servidor", () => {
    const result = resolveHealthCoverageYear(null, null);
    expect(result.year).toBeNull();
    expect(result.source).toBe("none");
  });

  it("nunca aplica default a un policyType distinto de HEALTH", () => {
    const result = healthDefaultTerminationDate("LIFE", 2026, new Date(Date.UTC(2026, 0, 1)));
    expect(result).toBeNull();
  });
});
