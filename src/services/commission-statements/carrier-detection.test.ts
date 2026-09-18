import { describe, it, expect } from "vitest";
import { normalizeCarrierForComparison, detectSingleCarrier, MultipleCarriersError } from "./carrier-detection";

describe("normalizeCarrierForComparison", () => {
  it("quita sufijos entre paréntesis y normaliza mayúsculas/espacios", () => {
    expect(normalizeCarrierForComparison("Oscar ( ACA)")).toBe("oscar");
    expect(normalizeCarrierForComparison("KAISER PERMANENTE")).toBe("kaiser permanente");
  });

  it("null/undefined/vacío se normalizan a null", () => {
    expect(normalizeCarrierForComparison(null)).toBeNull();
    expect(normalizeCarrierForComparison(undefined)).toBeNull();
    expect(normalizeCarrierForComparison("")).toBeNull();
    expect(normalizeCarrierForComparison("   ")).toBeNull();
  });

  // Fase 1.1 — UAT real "carrier no reconocido": 2 variantes reales de
  // BCBS que no calzaban con el catálogo ("BLUE CROSS BLUE SHIELD
  // (BCBS)") solo con el recorte de paréntesis, autorizadas por el
  // usuario tras revisión manual de los PDFs.
  it("'Blue Cross and Blue Shield' normaliza igual que el canónico BCBS", () => {
    expect(normalizeCarrierForComparison("Blue Cross and Blue Shield")).toBe(
      normalizeCarrierForComparison("BLUE CROSS BLUE SHIELD (BCBS)")
    );
  });

  it("'Blue Cross Blue' (sin 'Shield') normaliza igual que el canónico BCBS", () => {
    expect(normalizeCarrierForComparison("Blue Cross Blue")).toBe(
      normalizeCarrierForComparison("BLUE CROSS BLUE SHIELD (BCBS)")
    );
  });

  it("'Blue Cross Blue Shield (ACA)' ya normaliza igual sin necesidad de alias (el paréntesis se quita igual)", () => {
    expect(normalizeCarrierForComparison("Blue Cross Blue Shield (ACA)")).toBe(
      normalizeCarrierForComparison("BLUE CROSS BLUE SHIELD (BCBS)")
    );
  });

  it("un alias real nunca contamina otro carrier real (Oscar sigue siendo distinto de BCBS)", () => {
    expect(normalizeCarrierForComparison("Oscar ( ACA)")).not.toBe(normalizeCarrierForComparison("Blue Cross Blue"));
  });

  // Fase 1.1 — UAT real "Kaiser Abril/Julio/Febrero/Marzo": 4 archivos
  // reales de Kaiser reportan el carrier tal cual "Kaiser" (sin
  // "Permanente"), autorizado por el usuario como alias EXACTO.
  it("'Kaiser' normaliza igual que el canónico 'KAISER PERMANENTE'", () => {
    expect(normalizeCarrierForComparison("Kaiser")).toBe(normalizeCarrierForComparison("KAISER PERMANENTE"));
  });

  it("'Kaiser Permanente' (con mayúsculas/minúsculas mixtas) normaliza igual sin necesitar el alias", () => {
    expect(normalizeCarrierForComparison("Kaiser Permanente")).toBe(normalizeCarrierForComparison("KAISER PERMANENTE"));
  });

  it("'KAISER PERMANENTE' (el nombre canónico tal cual) se normaliza a sí mismo sin cambios", () => {
    expect(normalizeCarrierForComparison("KAISER PERMANENTE")).toBe("kaiser permanente");
  });

  it("rechaza nombres que solo CONTIENEN 'kaiser' pero no son equivalentes — nunca fuzzy/substring", () => {
    expect(normalizeCarrierForComparison("Kaiser Foundation")).not.toBe("kaiser permanente");
    expect(normalizeCarrierForComparison("Kaiser Foundation")).toBe("kaiser foundation");
    expect(normalizeCarrierForComparison("Kaiser SC")).not.toBe("kaiser permanente");
    expect(normalizeCarrierForComparison("Kaiser SC")).toBe("kaiser sc");
    expect(normalizeCarrierForComparison("Not Kaiser At All")).not.toBe("kaiser permanente");
  });
});

describe("detectSingleCarrier — variantes de BCBS cuentan como el MISMO carrier", () => {
  it("un archivo con 'Blue Cross and Blue Shield' en unas filas y 'Blue Cross Blue' en otras nunca se rechaza como multi-carrier", () => {
    const rows = [
      { carrier: "Blue Cross and Blue Shield" },
      { carrier: "Blue Cross Blue" },
      { carrier: "Blue Cross and Blue Shield" },
    ];
    expect(() => detectSingleCarrier(rows)).not.toThrow();
    expect(detectSingleCarrier(rows)).toBe("Blue Cross and Blue Shield"); // texto original de la primera aparición, nunca normalizado
  });

  it("sigue rechazando 2 carriers realmente distintos (Oscar + BCBS) en el mismo archivo", () => {
    const rows = [{ carrier: "Oscar ( ACA)" }, { carrier: "Blue Cross Blue" }];
    expect(() => detectSingleCarrier(rows)).toThrow(MultipleCarriersError);
  });
});
