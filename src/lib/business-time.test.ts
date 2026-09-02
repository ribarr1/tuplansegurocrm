import { describe, it, expect, afterEach } from "vitest";
import {
  getAppTimeZone,
  getBusinessDateParts,
  startOfBusinessDay,
  getTodayBusinessRange,
  _resetAppTimeZoneCacheForTests,
  formatDateTimeUS,
  formatDateUS,
  formatPeriodUS,
  formatMonthDayUS,
} from "@/lib/business-time";

const ORIGINAL_TZ = process.env.APP_TIME_ZONE;

afterEach(() => {
  process.env.APP_TIME_ZONE = ORIGINAL_TZ;
  _resetAppTimeZoneCacheForTests();
});

describe("business-time", () => {
  it("startOfBusinessDay calcula el instante UTC correcto en una zona detrás de UTC (America/Chicago, CST = UTC-6 en enero)", () => {
    const start = startOfBusinessDay(2026, 1, 15, "America/Chicago");
    expect(start.toISOString()).toBe("2026-01-15T06:00:00.000Z");
  });

  it("startOfBusinessDay calcula el instante UTC correcto en una zona adelante de UTC (Asia/Tokyo, UTC+9)", () => {
    const start = startOfBusinessDay(2026, 1, 15, "Asia/Tokyo");
    expect(start.toISOString()).toBe("2026-01-14T15:00:00.000Z");
  });

  it("getBusinessDateParts: un instante que ya es 'mañana' en UTC puede seguir siendo 'hoy' en una zona detrás de UTC", () => {
    // 2026-01-15T04:00:00Z es todavía 2026-01-14 22:00 en America/Chicago (CST, UTC-6).
    const instant = new Date("2026-01-15T04:00:00.000Z");
    const parts = getBusinessDateParts(instant, "America/Chicago");
    expect(parts).toEqual({ year: 2026, month: 1, day: 14 });
  });

  it("getBusinessDateParts: un instante que todavía es 'hoy' en UTC puede ya ser 'mañana' en una zona adelante de UTC", () => {
    // 2026-01-14T20:00:00Z es 2026-01-15 05:00 en Asia/Tokyo (UTC+9).
    const instant = new Date("2026-01-14T20:00:00.000Z");
    const parts = getBusinessDateParts(instant, "Asia/Tokyo");
    expect(parts).toEqual({ year: 2026, month: 1, day: 15 });
  });

  it("getTodayBusinessRange produce un rango [inicio, fin) de 24 horas consistente", () => {
    const { start, end, year, month, day } = getTodayBusinessRange("America/Chicago");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    const parts = getBusinessDateParts(start, "America/Chicago");
    expect(parts).toEqual({ year, month, day });
  });

  it("getAppTimeZone lee APP_TIME_ZONE de process.env y lo cachea", () => {
    process.env.APP_TIME_ZONE = "America/New_York";
    _resetAppTimeZoneCacheForTests();
    expect(getAppTimeZone()).toBe("America/New_York");
  });

  it("getAppTimeZone lanza un error claro si APP_TIME_ZONE no está configurado", () => {
    delete process.env.APP_TIME_ZONE;
    _resetAppTimeZoneCacheForTests();
    expect(() => getAppTimeZone()).toThrow(/APP_TIME_ZONE no está configurado/);
  });

  it("getAppTimeZone lanza un error claro si APP_TIME_ZONE es inválido", () => {
    process.env.APP_TIME_ZONE = "Not/AValidZone";
    _resetAppTimeZoneCacheForTests();
    expect(() => getAppTimeZone()).toThrow(/APP_TIME_ZONE inválido/);
  });

  // Hallazgo adicional de UAT (Fase 019.7): fechas visibles MM/DD/YYYY,
  // nunca DD/MM/YYYY ni un formato escrito en español.
  describe("formato MM/DD/YYYY para EE. UU.", () => {
    it("V) formatDateTimeUS produce MM/DD/YYYY, h:mm AM/PM", () => {
      // 2026-09-01T22:06:00Z = 2026-09-01 17:06 en America/Chicago (CDT, UTC-5).
      const instant = new Date("2026-09-01T22:06:00.000Z");
      expect(formatDateTimeUS(instant, "America/Chicago")).toBe("09/01/2026, 5:06 PM");
    });

    it("V) formatDateUS produce solo MM/DD/YYYY (sin hora), consciente de zona horaria", () => {
      const instant = new Date("2026-09-01T22:06:00.000Z");
      expect(formatDateUS(instant, "America/Chicago")).toBe("09/01/2026");
    });

    it("formatDateTimeUS/formatDateUS retornan '—' para null/undefined", () => {
      expect(formatDateTimeUS(null)).toBe("—");
      expect(formatDateUS(undefined)).toBe("—");
    });

    it("V) formatPeriodUS produce MM/YYYY para un período de comisión (día 1, ancla UTC)", () => {
      expect(formatPeriodUS(new Date("2026-09-01T00:00:00.000Z"))).toBe("09/2026");
    });

    it("V) formatMonthDayUS produce MM/DD para una ocurrencia de cumpleaños (sin año)", () => {
      expect(formatMonthDayUS(3, 15)).toBe("03/15");
      expect(formatMonthDayUS(12, 1)).toBe("12/01");
    });
  });
});
