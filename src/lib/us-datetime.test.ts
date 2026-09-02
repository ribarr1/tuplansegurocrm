import { describe, it, expect } from "vitest";
import { maskTwoDigits, combineUsDateTimeToIsoLocal, splitIsoLocalToUsDateTime } from "@/lib/us-datetime";

describe("us-datetime", () => {
  describe("maskTwoDigits", () => {
    it("elimina caracteres no numéricos y limita a 2 dígitos", () => {
      expect(maskTwoDigits("1a2b3")).toBe("12");
      expect(maskTwoDigits("")).toBe("");
      expect(maskTwoDigits("5")).toBe("5");
    });
  });

  describe("combineUsDateTimeToIsoLocal", () => {
    it("combina fecha + hora 12h + AM en 'YYYY-MM-DDTHH:mm' (24h)", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "9", "05", "AM")).toBe("2026-09-15T09:05");
    });

    it("combina fecha + hora 12h + PM sumando 12 horas", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "3", "30", "PM")).toBe("2026-09-15T15:30");
    });

    it("mediodía (12:00 PM) se mapea a hora 12, no 24", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "12", "00", "PM")).toBe("2026-09-15T12:00");
    });

    it("medianoche (12:00 AM) se mapea a hora 00", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "12", "00", "AM")).toBe("2026-09-15T00:00");
    });

    it("retorna '' si la fecha está incompleta", () => {
      expect(combineUsDateTimeToIsoLocal("09/15", "9", "05", "AM")).toBe("");
    });

    it("retorna '' si la hora está fuera de rango (0 o >12)", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "0", "05", "AM")).toBe("");
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "13", "05", "AM")).toBe("");
    });

    it("retorna '' si el minuto está fuera de rango", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "9", "60", "AM")).toBe("");
    });

    it("retorna '' si la hora o el minuto están vacíos", () => {
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "", "05", "AM")).toBe("");
      expect(combineUsDateTimeToIsoLocal("09/15/2026", "9", "", "AM")).toBe("");
    });

    it("retorna '' para una fecha de calendario inválida (ej. 02/30)", () => {
      expect(combineUsDateTimeToIsoLocal("02/30/2026", "9", "05", "AM")).toBe("");
    });
  });

  describe("splitIsoLocalToUsDateTime", () => {
    it("separa un ISO local en fecha US + hora 12h + AM/PM", () => {
      expect(splitIsoLocalToUsDateTime("2026-09-15T15:30")).toEqual({
        dateUs: "09/15/2026",
        hour12: "03",
        minute: "30",
        meridiem: "PM",
      });
    });

    it("hora 00 (medianoche) se separa como 12 AM", () => {
      expect(splitIsoLocalToUsDateTime("2026-09-15T00:00")).toEqual({
        dateUs: "09/15/2026",
        hour12: "12",
        minute: "00",
        meridiem: "AM",
      });
    });

    it("hora 12 (mediodía) se separa como 12 PM", () => {
      expect(splitIsoLocalToUsDateTime("2026-09-15T12:00")).toEqual({
        dateUs: "09/15/2026",
        hour12: "12",
        minute: "00",
        meridiem: "PM",
      });
    });

    it("retorna campos vacíos para null/undefined/''", () => {
      const empty = { dateUs: "", hour12: "", minute: "", meridiem: "AM" };
      expect(splitIsoLocalToUsDateTime(null)).toEqual(empty);
      expect(splitIsoLocalToUsDateTime(undefined)).toEqual(empty);
      expect(splitIsoLocalToUsDateTime("")).toEqual(empty);
    });

    it("retorna campos vacíos para un string sin el formato esperado", () => {
      const empty = { dateUs: "", hour12: "", minute: "", meridiem: "AM" };
      expect(splitIsoLocalToUsDateTime("no-es-una-fecha")).toEqual(empty);
    });

    it("es el inverso de combineUsDateTimeToIsoLocal (round-trip)", () => {
      const iso = combineUsDateTimeToIsoLocal("12/25/2026", "11", "45", "PM");
      expect(splitIsoLocalToUsDateTime(iso)).toEqual({
        dateUs: "12/25/2026",
        hour12: "11",
        minute: "45",
        meridiem: "PM",
      });
    });
  });
});
