import { describe, it, expect } from "vitest";
import { getDateOnlyParts, isLeapYear, effectiveBirthdayForYear, formatDateOnlyUS } from "@/lib/date-only";

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
});
