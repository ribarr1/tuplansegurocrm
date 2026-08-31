import { describe, it, expect } from "vitest";
import { getDateOnlyParts, isLeapYear, effectiveBirthdayForYear } from "@/lib/date-only";

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
});
