import "server-only";

// Zona horaria única de negocio (TuPlanSeguro USA opera como una sola
// agencia — mismo principio ya aplicado a "sin multi-tenancy" en
// docs/ARCHITECTURE.md, aquí aplicado a zona horaria). Sin esto,
// "hoy"/"este mes" dependían de la zona horaria del proceso Node, que
// puede no coincidir con la del negocio en producción (Fase 014).
//
// Debe ser un identificador IANA válido (ej. "America/Chicago"). Si
// falta o es inválido, se falla de forma clara en cuanto se usa —
// nunca se sigue silenciosamente con una zona horaria adivinada.

let cachedTimeZone: string | undefined;

function readAppTimeZone(): string {
  const raw = process.env.APP_TIME_ZONE?.trim();
  if (!raw) {
    throw new Error(
      'APP_TIME_ZONE no está configurado. Define un identificador de zona horaria IANA (ej. "America/Chicago") en .env.'
    );
  }
  try {
    // Intl lanza RangeError si el identificador no es una zona horaria
    // IANA válida — es la única forma estándar (sin dependencias) de
    // validar esto en tiempo de ejecución.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
  } catch {
    throw new Error(
      `APP_TIME_ZONE inválido: "${raw}". Debe ser un identificador de zona horaria IANA válido (ej. "America/Chicago", "America/New_York").`
    );
  }
  return raw;
}

export function getAppTimeZone(): string {
  if (!cachedTimeZone) cachedTimeZone = readAppTimeZone();
  return cachedTimeZone;
}

// Solo para tests: fuerza a releer process.env.APP_TIME_ZONE en la
// siguiente llamada, en vez de reutilizar el valor cacheado.
export function _resetAppTimeZoneCacheForTests(): void {
  cachedTimeZone = undefined;
}

function formatPartsMap(date: Date, options: Intl.DateTimeFormatOptions, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

// Convierte una hora "de pared" (año/mes/día/hora/min/seg) en una zona
// horaria dada al instante UTC real que representa — necesario para
// construir límites de día correctos en la zona de negocio (maneja DST
// automáticamente, a diferencia de sumar/restar un offset fijo).
//
// Técnica estándar (la misma que usan librerías como date-fns-tz):
// 1. Se interpreta Y-M-D-hh-mm-ss como si ya fuera UTC (una "adivinanza").
// 2. Se formatea ese instante en la zona objetivo para ver a qué hora
//    de pared corresponde ahí.
// 3. La diferencia entre ambas es el offset real de esa zona en esa
//    fecha — se resta para corregir la adivinanza.
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const map = formatPartsMap(new Date(utcGuess), {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }, timeZone);
  const hourValue = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hourValue,
    Number(map.minute),
    Number(map.second)
  );
  const offset = asUtc - utcGuess;
  return new Date(utcGuess - offset);
}

// Componentes de calendario (año/mes/día) de un instante, tal como se
// ven en la zona horaria de negocio — ej. "qué día es hoy" para el
// negocio, sin importar en qué zona corre el proceso Node.
export function getBusinessDateParts(
  date: Date,
  timeZone: string = getAppTimeZone()
): { year: number; month: number; day: number } {
  const map = formatPartsMap(date, { year: "numeric", month: "2-digit", day: "2-digit" }, timeZone);
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

export function startOfBusinessDay(
  year: number,
  month: number,
  day: number,
  timeZone: string = getAppTimeZone()
): Date {
  return zonedTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

// [inicio, fin) del día de negocio "hoy" como instantes UTC, más sus
// componentes Y/M/D — fuente única para Task "Hoy" y Birthday
// "Hoy"/"Este mes" (antes cada uno calculaba esto por su cuenta con la
// hora local del proceso, ver docs/DECISIONS.md Fase 014/015).
export function getTodayBusinessRange(timeZone: string = getAppTimeZone()): {
  start: Date;
  end: Date;
  year: number;
  month: number;
  day: number;
} {
  const { year, month, day } = getBusinessDateParts(new Date(), timeZone);
  const start = startOfBusinessDay(year, month, day, timeZone);
  // Sumar un día vía Date.UTC (no zonedTimeToUtc) es seguro: Date.UTC
  // normaliza el desborde (día 32 -> primer día del mes siguiente) sin
  // lógica de calendario manual ni riesgo de zona horaria.
  const nextDayAnchor = new Date(Date.UTC(year, month - 1, day + 1));
  const end = startOfBusinessDay(
    nextDayAnchor.getUTCFullYear(),
    nextDayAnchor.getUTCMonth() + 1,
    nextDayAnchor.getUTCDate(),
    timeZone
  );
  return { start, end, year, month, day };
}

// Para mostrar un timestamp (ej. Task.dueAt) en la zona horaria de
// negocio, en vez de la del proceso/navegador — mismo problema que
// resuelve getTodayBusinessRange, aplicado a presentación.
export function formatInBusinessTimeZone(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  timeZone: string = getAppTimeZone()
): string {
  return new Intl.DateTimeFormat("es-US", { ...options, timeZone }).format(date);
}
