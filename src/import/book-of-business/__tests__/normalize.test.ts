import { describe, it, expect } from "vitest";
import {
  normalizeCarrierName,
  normalizePlanName,
  normalizeUsState,
  mapImmigrationSource,
  mapPolicyStatus,
  mapOperationType,
  isSourceYes,
  normalizeNameForMatch,
  parseSourceDateMDY,
  parseSourceAmount,
  comparePolicyChronology,
} from "../normalize";

describe("book-of-business normalize", () => {
  it("normaliza nombre de carrier: trim + minúsculas + espacios colapsados", () => {
    expect(normalizeCarrierName("  Highmark   BCBS ")).toBe(normalizeCarrierName("HIGHMARK BCBS"));
    expect(normalizeCarrierName("HIGHMARK  BCBS")).toBe(normalizeCarrierName("Highmark Bcbs"));
  });

  it("no fusiona carriers distintos aunque parezcan relacionados", () => {
    expect(normalizeCarrierName("BCBS HORIZON")).not.toBe(normalizeCarrierName("CAREFIRST BCBS"));
    expect(normalizeCarrierName("BLUE CROSS BLUE SHIELD (BCBS)")).not.toBe(normalizeCarrierName("BCBS HORIZON"));
  });

  it("normaliza nombre de plan: trim + espacios colapsados, sin alterar contenido", () => {
    expect(normalizePlanName("  GOLD   SIMPLE  ")).toBe("GOLD SIMPLE");
    expect(normalizePlanName("Silver Plus")).toBe("Silver Plus");
  });

  it("mapea estados fuente conocidos a código de 2 letras", () => {
    expect(normalizeUsState("ILLINOIS")).toEqual({ code: "IL", matched: true });
    expect(normalizeUsState("georgia")).toEqual({ code: "GA", matched: true });
    expect(normalizeUsState("Nueva Jersey")).toEqual({ code: "NJ", matched: true });
    expect(normalizeUsState("Carolina del Sur")).toEqual({ code: "SC", matched: true });
  });

  it("reporta un estado fuente no reconocido en vez de adivinar", () => {
    expect(normalizeUsState("Wyoming")).toEqual({ code: null, matched: false });
  });

  it("mapea categoría migratoria + tipo de documento desde el source", () => {
    expect(mapImmigrationSource("CIUDADANO")).toEqual({ immigrationCategory: "US_CITIZEN", documentType: null });
    expect(mapImmigrationSource("Green Card")).toEqual({
      immigrationCategory: "LAWFUL_PERMANENT_RESIDENT",
      documentType: "PERMANENT_RESIDENT_CARD",
    });
    expect(mapImmigrationSource("permiso de trabajo")).toEqual({
      immigrationCategory: "EMPLOYMENT_AUTHORIZATION",
      documentType: "EMPLOYMENT_AUTHORIZATION_DOCUMENT",
    });
    expect(mapImmigrationSource("Otro")).toEqual({ immigrationCategory: "OTHER", documentType: "OTHER" });
  });

  it("un valor de inmigración desconocido no se adivina (null)", () => {
    expect(mapImmigrationSource("VISA DE TURISTA")).toBeNull();
  });

  it("mapea ESTATUS fuente al PolicyStatus real", () => {
    expect(mapPolicyStatus("CANCELADA")).toBe("CANCELLED");
    expect(mapPolicyStatus("CREADA")).toBe("PENDING");
    expect(mapPolicyStatus("ENVIADA")).toBe("PENDING");
    expect(mapPolicyStatus("PROCESADA")).toBe("ACTIVE");
    expect(mapPolicyStatus("ALGO_RARO")).toBeNull();
  });

  it("mapea TIPO DE APLICACION al PolicyOperationType real", () => {
    expect(mapOperationType("CLIENTE NUEVO")).toBe("NEW_ENROLLMENT");
    expect(mapOperationType("RENOVACION")).toBe("RENEWAL");
    expect(mapOperationType("CAMBIO DE PLAN")).toBe("REPLACEMENT");
  });

  it("solo 'SI'/'SÍ' cuentan como cobertura afirmativa", () => {
    expect(isSourceYes("SI")).toBe(true);
    expect(isSourceYes("sí")).toBe(true);
    expect(isSourceYes("NO")).toBe(false);
    expect(isSourceYes("")).toBe(false);
  });

  it("normaliza nombres para matching ignorando tildes/mayúsculas/espacios", () => {
    expect(normalizeNameForMatch("José", "Pérez")).toBe(normalizeNameForMatch("JOSE", "PEREZ"));
    expect(normalizeNameForMatch(" Ana  ", "  Lopez")).toBe(normalizeNameForMatch("Ana", "Lopez"));
  });

  it("parsea fechas MM/DD/YYYY reales, rechaza fechas de calendario inválidas", () => {
    expect(parseSourceDateMDY("01/15/2026")).toEqual(new Date(Date.UTC(2026, 0, 15)));
    expect(parseSourceDateMDY("02/30/2026")).toBeNull();
    expect(parseSourceDateMDY("13/01/2026")).toBeNull();
    expect(parseSourceDateMDY("")).toBeNull();
    expect(parseSourceDateMDY("02/29/2028")).toEqual(new Date(Date.UTC(2028, 1, 29)));
  });

  it("parsea montos con $ y comas, rechaza texto no numérico", () => {
    expect(parseSourceAmount("$1,234.50")).toBe(1234.5);
    expect(parseSourceAmount("125")).toBe(125);
    expect(parseSourceAmount("")).toBeNull();
    expect(parseSourceAmount("N/A")).toBeNull();
  });

  it("orden cronológico: NEW_ENROLLMENT precede a RENEWAL/REPLACEMENT en la misma fecha", () => {
    const sameDate = new Date(Date.UTC(2026, 4, 1));
    const a = { effectiveDate: sameDate, operationType: "REPLACEMENT" };
    const b = { effectiveDate: sameDate, operationType: "NEW_ENROLLMENT" };
    const sorted = [a, b].sort(comparePolicyChronology);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
  });
});
