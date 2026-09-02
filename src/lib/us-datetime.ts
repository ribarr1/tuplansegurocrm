import { maskUsDate, usDateToIso, isoToUsDate } from "@/lib/date-only";

// Hallazgo #5 de UAT (Fase 020): Task.dueAt es DateTime (fecha + hora),
// no date-only — USDateTimeInput compone un USDateInput (MM/DD/AAAA)
// con hora en formato 12h + AM/PM (nunca 24h en la UI, consistente con
// el resto de la app orientada a EE. UU.). El valor que viaja al
// servidor es "YYYY-MM-DDTHH:mm" (24h, mismo formato que ya producía
// <input type="datetime-local">) — SIN información de zona horaria:
// el servidor lo interpreta explícitamente como hora de pared en
// APP_TIME_ZONE (ver zonedTimeToUtc en business-time.ts), nunca con la
// zona horaria ambigua del proceso Node. Estas funciones son puras y
// client-safe (sin "server-only") para poder usarse en el componente
// de cliente.

export type Meridiem = "AM" | "PM";

export function maskTwoDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2);
}

// "3" -> "03" solo al perder el foco / al combinar — nunca mientras el
// usuario todavía está escribiendo (evita "saltar" el cursor).
function padTwo(value: string): string {
  if (value === "") return "";
  return value.padStart(2, "0");
}

// Combina los 4 campos del usuario en "YYYY-MM-DDTHH:mm" (24h) — "" si
// cualquier parte está incompleta o es inválida. Nunca lanza.
export function combineUsDateTimeToIsoLocal(
  dateUs: string,
  hour12: string,
  minute: string,
  meridiem: Meridiem
): string {
  const isoDate = usDateToIso(dateUs);
  if (!isoDate) return "";

  // Number("") === 0 (no NaN) — hay que rechazar el string vacío
  // explícitamente antes de convertir, o "09:" con minuto vacío pasaría
  // la validación como si fuera minuto 0.
  if (hour12.trim() === "" || minute.trim() === "") return "";
  const hourNum = Number(hour12);
  const minuteNum = Number(minute);
  if (!Number.isInteger(hourNum) || hourNum < 1 || hourNum > 12) return "";
  if (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 59) return "";

  let hour24 = hourNum % 12;
  if (meridiem === "PM") hour24 += 12;

  return `${isoDate}T${String(hour24).padStart(2, "0")}:${padTwo(minute)}`;
}

// Camino inverso — para precargar el formulario de edición a partir de
// un valor "YYYY-MM-DDTHH:mm" ya calculado en APP_TIME_ZONE (ver
// getBusinessDateTimeParts en business-time.ts, llamado desde el
// Server Component, nunca aquí).
export function splitIsoLocalToUsDateTime(iso: string | null | undefined): {
  dateUs: string;
  hour12: string;
  minute: string;
  meridiem: Meridiem;
} {
  if (!iso) return { dateUs: "", hour12: "", minute: "", meridiem: "AM" };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return { dateUs: "", hour12: "", minute: "", meridiem: "AM" };
  const [, isoDate, hh, mm] = match;
  const hour24 = Number(hh);
  const meridiem: Meridiem = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return {
    dateUs: isoToUsDate(isoDate),
    hour12: String(hour12).padStart(2, "0"),
    minute: mm,
    meridiem,
  };
}

export { maskUsDate };
