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
  getBusinessDateTimeParts,
  toBusinessDateTimeLocalString,
  zonedTimeToUtc,
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

  // Fase 020 (§5): Task.dueAt es DateTime, no date-only — USDateTimeInput
  // necesita componentes de hora/minuto correctos en APP_TIME_ZONE (nunca
  // la zona del proceso Node) tanto para precargar el formulario de
  // edición como para el round-trip completo string -> Date -> string.
  describe("hora de pared para Task.dueAt (Fase 020)", () => {
    it("getBusinessDateTimeParts extrae año/mes/día/hora/minuto en la zona de negocio, no en la del proceso", () => {
      // 2026-09-01T22:06:00Z = 2026-09-01 17:06 en America/Chicago (CDT, UTC-5).
      const instant = new Date("2026-09-01T22:06:00.000Z");
      expect(getBusinessDateTimeParts(instant, "America/Chicago")).toEqual({
        year: 2026,
        month: 9,
        day: 1,
        hour: 17,
        minute: 6,
      });
    });

    it("getBusinessDateTimeParts: mediodía (12:00 PM) en la zona de negocio", () => {
      // 2026-09-01T17:00:00Z = 2026-09-01 12:00 en America/Chicago (CDT, UTC-5).
      const instant = new Date("2026-09-01T17:00:00.000Z");
      expect(getBusinessDateTimeParts(instant, "America/Chicago").hour).toBe(12);
    });

    it("getBusinessDateTimeParts: medianoche (12:00 AM) en la zona de negocio", () => {
      // 2026-09-01T05:00:00Z = 2026-09-01 00:00 en America/Chicago (CDT, UTC-5).
      const instant = new Date("2026-09-01T05:00:00.000Z");
      const parts = getBusinessDateTimeParts(instant, "America/Chicago");
      expect(parts.hour).toBe(0);
      expect(parts.day).toBe(1);
    });

    it("toBusinessDateTimeLocalString produce 'YYYY-MM-DDTHH:mm' en la zona de negocio", () => {
      const instant = new Date("2026-09-01T22:06:00.000Z");
      expect(toBusinessDateTimeLocalString(instant, "America/Chicago")).toBe("2026-09-01T17:06");
    });

    it("toBusinessDateTimeLocalString retorna '' para null/undefined", () => {
      expect(toBusinessDateTimeLocalString(null)).toBe("");
      expect(toBusinessDateTimeLocalString(undefined)).toBe("");
    });

    it("toBusinessDateTimeLocalString es consistente entre zonas horarias distintas (mismo instante, distinta hora de pared)", () => {
      const instant = new Date("2026-01-15T12:00:00.000Z");
      expect(toBusinessDateTimeLocalString(instant, "America/Chicago")).toBe("2026-01-15T06:00");
      expect(toBusinessDateTimeLocalString(instant, "Asia/Tokyo")).toBe("2026-01-15T21:00");
    });

    it("toBusinessDateTimeLocalString(instante) coincide con la hora de pared esperada para un instante conocido", () => {
      const known = new Date("2026-09-15T20:30:00.000Z"); // 15:30 CDT (UTC-5)
      expect(toBusinessDateTimeLocalString(known, "America/Chicago")).toBe("2026-09-15T15:30");
    });

    it("zonedTimeToUtc y toBusinessDateTimeLocalString son inversas (round-trip completo, tal como lo usa resolveDueAt en tasks.service)", () => {
      const utc = zonedTimeToUtc(2026, 9, 15, 15, 30, 0, "America/Chicago");
      expect(toBusinessDateTimeLocalString(utc, "America/Chicago")).toBe("2026-09-15T15:30");
    });

    it("zonedTimeToUtc respeta el cambio de horario (DST) al construir el mismo horario de pared en enero (CST, UTC-6)", () => {
      const utc = zonedTimeToUtc(2026, 1, 15, 15, 30, 0, "America/Chicago");
      expect(toBusinessDateTimeLocalString(utc, "America/Chicago")).toBe("2026-01-15T15:30");
      expect(utc.toISOString()).toBe("2026-01-15T21:30:00.000Z");
    });
  });
});
