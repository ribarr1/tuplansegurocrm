import { describe, it, expect } from "vitest";
import {
  getDateOnlyParts,
  isLeapYear,
  effectiveBirthdayForYear,
  formatDateOnlyUS,
  maskUsDate,
  usDateToIso,
  isoToUsDate,
} from "@/lib/date-only";

describe("date-only", () => {
  it("getDateOnlyParts lee una columna DATE (medianoche UTC) sin desplazarse de día", () => {
    // Como llegaría de Prisma para una columna @db.Date: 1990-09-15,
    // representada como 1990-09-15T00:00:00.000Z.
    const dob = new Date("1990-09-15T00:00:00.000Z");
    expect(getDateOnlyParts(dob)).toEqual({ year: 1990, month: 9, day: 15 });
  });

  it("getDateOnlyParts no se ve afectado por la zona horaria del proceso (getters UTC, no locales)", () => {
    // Si se leyera con getters locales en un proceso con offset
    // negativo respecto a UTC, esta fecha podría mostrarse como 31 de
    // diciembre del año anterior. Los getters UTC son inmunes a eso.
    const dob = new Date("2000-01-01T00:00:00.000Z");
    expect(getDateOnlyParts(dob)).toEqual({ year: 2000, month: 1, day: 1 });
  });

  it("isLeapYear identifica años bisiestos correctamente (incluye la regla de siglo)", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2000)).toBe(true); // divisible entre 400
    expect(isLeapYear(1900)).toBe(false); // divisible entre 100, no entre 400
  });

  it("effectiveBirthdayForYear: 29 de febrero en año bisiesto se mantiene 29 de febrero", () => {
    expect(effectiveBirthdayForYear(2, 29, 2024)).toEqual({ month: 2, day: 29 });
  });

  it("effectiveBirthdayForYear: 29 de febrero en año no bisiesto se celebra el 28 de febrero (convención V1)", () => {
    expect(effectiveBirthdayForYear(2, 29, 2025)).toEqual({ month: 2, day: 28 });
    expect(effectiveBirthdayForYear(2, 29, 2026)).toEqual({ month: 2, day: 28 });
  });

  it("effectiveBirthdayForYear no altera fechas que no son 29 de febrero", () => {
    expect(effectiveBirthdayForYear(9, 15, 2026)).toEqual({ month: 9, day: 15 });
    expect(effectiveBirthdayForYear(2, 28, 2026)).toEqual({ month: 2, day: 28 });
  });

  // V) formato MM/DD/YYYY para el CRM en EE. UU. (hallazgo adicional de
  // UAT, Fase 019.7) — nunca DD/MM/YYYY ni un formato escrito.
  it("V) formatDateOnlyUS produce MM/DD/YYYY, no DD/MM/YYYY", () => {
    // 1 de septiembre de 2026 — si se leyera como DD/MM daría "01/09"
    // (1 de septiembre en notación europea); en MM/DD debe ser "09/01".
    expect(formatDateOnlyUS(new Date("2026-09-01T00:00:00.000Z"))).toBe("09/01/2026");
  });

  it("V) formatDateOnlyUS rellena con ceros mes y día de un solo dígito", () => {
    expect(formatDateOnlyUS(new Date("2026-01-05T00:00:00.000Z"))).toBe("01/05/2026");
  });

  it("formatDateOnlyUS retorna '—' para null/undefined, nunca revienta", () => {
    expect(formatDateOnlyUS(null)).toBe("—");
    expect(formatDateOnlyUS(undefined)).toBe("—");
  });

  // X) sin desplazamiento de zona horaria — misma garantía que
  // getDateOnlyParts, aplicada al formateo final visible al usuario.
  it("X) formatDateOnlyUS no se desplaza de día sin importar la zona horaria del proceso", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14, el offset positivo más extremo real
      expect(formatDateOnlyUS(new Date("2026-01-01T00:00:00.000Z"))).toBe("01/01/2026");
    } finally {
      process.env.TZ = original;
    }
  });

  // W) round-trip: un Date construido a partir de un string ISO
  // "YYYY-MM-DD" (como lo produce <input type="date">) siempre da la
  // misma fecha calendario al formatearse de vuelta con formatDateOnlyUS.
  it("W) round-trip: 'YYYY-MM-DD' -> Date -> formatDateOnlyUS conserva el mismo día calendario", () => {
    const isoDateOnly = "2026-12-25";
    // new Date("YYYY-MM-DD") (sin componente de hora) se interpreta
    // como medianoche UTC por la especificación ECMA-262 — mismo
    // principio ya documentado para nextPaymentDueDate/effectiveDate.
    const parsed = new Date(isoDateOnly);
    expect(formatDateOnlyUS(parsed)).toBe("12/25/2026");
  });

  // A-F) UAT hallazgo #16 (Fase 019.8): <USDateInput> reemplaza
  // <input type="date"> para garantizar MM/DD/AAAA sin depender del
  // locale del navegador — estas funciones puras son su lógica.
  it("A) usDateToIso interpreta MM/DD/AAAA -> YYYY-MM-DD", () => {
    expect(usDateToIso("09/01/2026")).toBe("2026-09-01");
  });

  it("B) usDateToIso produce el string exacto que ya esperaban los schemas existentes", () => {
    expect(usDateToIso("12/31/2026")).toBe("2026-12-31");
  });

  it("C) usDateToIso rechaza un mes inválido (13/10/2026, 00/01/2026)", () => {
    expect(usDateToIso("13/10/2026")).toBe("");
    expect(usDateToIso("00/01/2026")).toBe("");
  });

  it("D) usDateToIso rechaza un día inválido (30 de febrero)", () => {
    expect(usDateToIso("02/30/2026")).toBe("");
  });

  it("E) usDateToIso acepta 29 de febrero en año bisiesto y lo rechaza en año no bisiesto", () => {
    expect(usDateToIso("02/29/2028")).toBe("2028-02-29");
    expect(usDateToIso("02/29/2026")).toBe("");
  });

  it("F) usDateToIso retorna '' para un valor incompleto (nunca lanza)", () => {
    expect(usDateToIso("09/01")).toBe("");
    expect(usDateToIso("")).toBe("");
  });

  it("isoToUsDate hace el camino inverso para precargar un formulario de edición", () => {
    expect(isoToUsDate("2026-09-01")).toBe("09/01/2026");
    expect(isoToUsDate(null)).toBe("");
    expect(isoToUsDate(undefined)).toBe("");
  });

  it("maskUsDate inserta las barras automáticamente mientras el usuario escribe", () => {
    expect(maskUsDate("0")).toBe("0");
    expect(maskUsDate("09")).toBe("09");
    expect(maskUsDate("090")).toBe("09/0");
    expect(maskUsDate("09012026")).toBe("09/01/2026");
  });

  it("maskUsDate ignora caracteres no numéricos (pegado con barras ya incluidas)", () => {
    expect(maskUsDate("09/01/2026")).toBe("09/01/2026");
  });

  it("maskUsDate trunca cualquier dígito extra más allá de MMDDYYYY", () => {
    expect(maskUsDate("090120269999")).toBe("09/01/2026");
  });
});
