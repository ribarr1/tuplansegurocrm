import "server-only";
import type { AnalyticsPeriodInput } from "@/schemas/analytics.schema";

// Resuelve Mes/Trimestre/Año/Rango/Todo a un intervalo [start, end)
// exclusivo en UTC — reutilizado por ambos dashboards de analítica
// (comisiones y pólizas) para que "seleccionar el mismo período" en
// los dos módulos signifique EXACTAMENTE el mismo rango de fechas.
// `end` exclusivo evita el error clásico de "incluir medianoche del
// día siguiente" al comparar contra un DateTime con hora.
export type ResolvedAnalyticsPeriod = { start: Date | null; end: Date | null };

function monthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function resolveAnalyticsPeriod(input: AnalyticsPeriodInput): ResolvedAnalyticsPeriod {
  const mode = input.periodMode ?? "ALL";

  if (mode === "MONTH" && input.year !== undefined && input.month !== undefined) {
    return { start: monthStartUTC(input.year, input.month), end: monthStartUTC(input.year, input.month + 1) };
  }

  if (mode === "QUARTER" && input.year !== undefined && input.quarter !== undefined) {
    const startMonth = (input.quarter - 1) * 3 + 1;
    return { start: monthStartUTC(input.year, startMonth), end: monthStartUTC(input.year, startMonth + 3) };
  }

  if (mode === "YEAR" && input.year !== undefined) {
    return { start: monthStartUTC(input.year, 1), end: monthStartUTC(input.year + 1, 1) };
  }

  if (mode === "RANGE" && input.startDate && input.endDate) {
    // endDate es inclusiva desde la perspectiva del usuario ("hasta el
    // 31 de marzo") — se convierte a exclusiva sumando un día.
    const end = new Date(input.endDate);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start: input.startDate, end };
  }

  return { start: null, end: null };
}

// Genera cada mes calendario [start, end) del intervalo resuelto, para
// desglosar "tendencia mensual" — nunca más de 240 meses (20 años) para
// evitar generar un desglose absurdamente largo si alguien pasara un
// rango enorme.
export function enumerateMonths(start: Date, end: Date): { year: number; month: number; start: Date; end: Date }[] {
  const months: { year: number; month: number; start: Date; end: Date }[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  let guard = 0;
  while (cursor < end && guard < 240) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const monthEnd = monthStartUTC(year, month + 1);
    months.push({ year, month, start: cursor, end: monthEnd });
    cursor = monthEnd;
    guard += 1;
  }
  return months;
}
