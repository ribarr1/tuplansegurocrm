import { describe, it, expect } from "vitest";
import { dateOnlySchema, isValidDateOnlyString } from "@/schemas/common";

// Fase 022 (Hallazgo #1 de UAT): validación de fecha real de
// calendario, no solo forma. Causa raíz: z.coerce.date() delega en
// `new Date(string)`, que para el formato ISO date-only ACEPTA
// silenciosamente días fuera de rango (ej. "2026-02-30" -> 2 de marzo)
// en vez de rechazarlos — dateOnlySchema/isValidDateOnlyString cierran
// exactamente ese hueco.

describe("common — dateOnlySchema (Hallazgo #1 de UAT)", () => {
  it("acepta una fecha real válida", () => {
    expect(isValidDateOnlyString("2026-09-01")).toBe(true);
    expect(dateOnlySchema().safeParse("2026-09-01").success).toBe(true);
  });

  it("acepta 29 de febrero en año bisiesto", () => {
    expect(isValidDateOnlyString("2028-02-29")).toBe(true);
  });

  it("rechaza 29 de febrero en año NO bisiesto", () => {
    expect(isValidDateOnlyString("2025-02-29")).toBe(false);
  });

  it("rechaza 30 de febrero (root cause: new Date() lo redondea a marzo en vez de rechazarlo)", () => {
    // Confirma que new Date() en efecto tiene este comportamiento
    // lenient — la razón por la que dateOnlySchema existe.
    expect(new Date("2026-02-30").toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(isValidDateOnlyString("2026-02-30")).toBe(false);
    expect(dateOnlySchema().safeParse("2026-02-30").success).toBe(false);
  });

  it("rechaza 31 de abril (abril tiene 30 días)", () => {
    expect(isValidDateOnlyString("2026-04-31")).toBe(false);
  });

  it("rechaza mes 13", () => {
    expect(isValidDateOnlyString("2026-13-01")).toBe(false);
  });

  it("rechaza mes 00", () => {
    expect(isValidDateOnlyString("2026-00-15")).toBe(false);
  });

  it("rechaza una fecha con formato de mes/día invertido fuera de rango (equivalente a 15/42/2026)", () => {
    // usDateToIso ya rechaza esto en el cliente; aquí se confirma que
    // el servidor también lo rechazaría si de alguna forma llegara.
    expect(isValidDateOnlyString("2026-15-42")).toBe(false);
  });

  it("rechaza una fecha parcial o con caracteres inválidos", () => {
    expect(isValidDateOnlyString("2026-09")).toBe(false);
    expect(isValidDateOnlyString("2026/09/01")).toBe(false);
    expect(isValidDateOnlyString("not-a-date")).toBe(false);
    expect(isValidDateOnlyString("")).toBe(false);
  });

  it("dateOnlySchema acepta un Date real ya construido (compatibilidad con llamadas internas/tests)", () => {
    const result = dateOnlySchema().safeParse(new Date("2026-09-01"));
    expect(result.success).toBe(true);
  });

  it("dateOnlySchema produce un Date anclado a medianoche UTC del día correcto", () => {
    const result = dateOnlySchema().parse("2026-09-01");
    expect(result.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
