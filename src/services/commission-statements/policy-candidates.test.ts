import { describe, it, expect } from "vitest";
import { computePeriodMatch, maskPolicyNumber } from "./policy-candidates";

// ---------------------------------------------------------------------------
// Fase 025.5.6 (UAT-22) — computePeriodMatch es una función PURA
// (nunca toca la base de datos), así que se prueba exhaustivamente
// aquí de forma aislada; los tests de integración (con Policy/Product
// reales) viven en pdf-import.service.test.ts.
// ---------------------------------------------------------------------------
describe("computePeriodMatch (UAT-22 — vigencia)", () => {
  const jan2026 = new Date(Date.UTC(2026, 0, 1));
  const dec2026 = new Date(Date.UTC(2026, 11, 1));
  const jul2026 = new Date(Date.UTC(2026, 6, 1));

  it("primer mes de cobertura (inclusive) coincide", () => {
    expect(computePeriodMatch(jan2026, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("MATCH");
  });

  it("último mes de cobertura (inclusive) coincide", () => {
    expect(computePeriodMatch(dec2026, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("MATCH");
  });

  it("mes anterior al inicio de vigencia queda fuera del periodo", () => {
    const dec2025 = new Date(Date.UTC(2025, 11, 1));
    expect(computePeriodMatch(dec2025, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("OUT_OF_PERIOD");
  });

  it("mes posterior a la terminación queda fuera del periodo", () => {
    const jan2027 = new Date(Date.UTC(2027, 0, 1));
    expect(computePeriodMatch(jan2027, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("OUT_OF_PERIOD");
  });

  it("sin terminationDate se asume cobertura abierta hacia adelante (nunca se inventa una fecha)", () => {
    const yearsLater = new Date(Date.UTC(2030, 5, 1));
    expect(computePeriodMatch(yearsLater, new Date("2026-01-01"), null)).toBe("MATCH");
  });

  it("póliza de un año distinto (2025) frente a comisión de 2026 queda fuera del periodo — caso reportado en UAT-22", () => {
    expect(computePeriodMatch(jul2026, new Date("2025-01-01"), new Date("2025-12-31"))).toBe("OUT_OF_PERIOD");
  });

  it("póliza del mismo año (2026) que la comisión coincide — caso reportado en UAT-22", () => {
    expect(computePeriodMatch(jul2026, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("MATCH");
  });

  it("sin effectiveDate en la póliza -> vigencia incompleta, nunca 'coincide' ni se inventa una fecha", () => {
    expect(computePeriodMatch(jul2026, null, null)).toBe("INCOMPLETE");
  });

  it("sin periodo de comisión (fila sin paidAt ni effectiveDate) -> incompleto", () => {
    expect(computePeriodMatch(null, new Date("2026-01-01"), new Date("2026-12-31"))).toBe("INCOMPLETE");
  });

  it("nunca hay desplazamiento por zona horaria — una fecha de fin de mes a medianoche UTC sigue cubriendo ese mes completo", () => {
    // 2026-12-31T00:00:00Z es el ancla real de una columna @db.Date;
    // si se reinterpretara con una zona horaria negativa (ej.
    // America/Chicago, UTC-6) restaría un día y "perdería" el mes.
    const terminationAtMidnightUtc = new Date("2026-12-31T00:00:00.000Z");
    expect(computePeriodMatch(dec2026, new Date("2026-01-01"), terminationAtMidnightUtc)).toBe("MATCH");
  });
});

describe("maskPolicyNumber (UAT-22 — nunca exponer el número completo)", () => {
  it("conserva solo los últimos 4 caracteres", () => {
    expect(maskPolicyNumber("ABC123456789")).toBe("********6789");
  });

  it("null se conserva como null", () => {
    expect(maskPolicyNumber(null)).toBeNull();
  });

  it("un número de 4 caracteres o menos se enmascara por completo", () => {
    expect(maskPolicyNumber("12")).toBe("**");
  });
});
