import { describe, it, expect, afterEach } from "vitest";
import {
  getAppTimeZone,
  getBusinessDateParts,
  startOfBusinessDay,
  getTodayBusinessRange,
  _resetAppTimeZoneCacheForTests,
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
});
