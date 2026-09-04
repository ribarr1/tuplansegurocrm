import { z } from "zod";

// Los filtros de las páginas de lista llegan desde searchParams de la
// URL — un <select>/<input> vacío en un <form method="GET"> serializa
// como "clave=" (string vacío), no como "ausente". Sin este
// preprocesamiento, un campo z.uuid().optional()/z.string().min(1)
// rechaza esa string vacía en vez de tratarla como "sin filtro" —
// bug real encontrado en Fase 014 (afectaba también Contactos y
// Pólizas, no solo Tareas) al enviar un formulario de filtro sin
// cambiar ninguna opción. Envolver el campo en
// z.preprocess(emptyStringToUndefined, ...) lo hace tolerante de forma
// permanente, sin depender de que cada page.tsx recuerde hacer
// `sp.campo || undefined` antes de llamar al servicio.
export function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export function optionalUuidFilter(message?: string) {
  return z.preprocess(emptyStringToUndefined, z.uuid(message).optional());
}

export function optionalSearchFilter(max = 200) {
  return z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).max(max).optional()
  );
}

// Mismo problema que optionalUuidFilter/optionalSearchFilter, para
// filtros de tipo enum (ej. status="" cuando un <select> queda en
// "Todos") y booleanos (ej. autopay="" cuando un <select> queda en
// "Todas"). Bug real encontrado en Fase 019.5: /premiums?autopay=
// (select sin cambiar) producía VALIDATION_ERROR "Invalid option:
// expected one of true|false" en vez de tratarse como "sin filtro" —
// mismo patrón que el bug de Fase 014, pero en un helper local nuevo
// que no reusó z.preprocess(emptyStringToUndefined, ...). Centralizado
// aquí para que ningún filtro nuevo pueda repetir el error.
export function optionalEnumFilter<T extends readonly [string, ...string[]]>(
  values: T,
  message?: string
) {
  return z.preprocess(emptyStringToUndefined, z.enum(values, message).optional());
}

export function optionalBooleanFilter() {
  return z.preprocess(
    emptyStringToUndefined,
    z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional()
  );
}

// Fase 022 (Hallazgo #1 de UAT): validación de fecha CENTRALIZADA y
// real de calendario, para reemplazar z.coerce.date() en cualquier
// campo date-only (effectiveDate, terminationDate, nextPaymentDueDate,
// dateOfBirth, etc.).
//
// Causa raíz del hallazgo: z.coerce.date() sobre un string delega en
// `new Date(string)`, que para el formato ISO date-only es LENIENTE
// con días fuera de rango — silenciosamente los "rueda" al mes
// siguiente en vez de rechazarlos:
//   new Date("2026-02-30").toISOString() === "2026-03-02T00:00:00.000Z"
// El enmascarado visual de USDateInput ya rechaza esto en el cliente
// (usDateToIso retorna "" para una fecha inválida), pero el servidor
// NUNCA debe depender solo de eso — este validador re-valida el
// string de forma estricta, independientemente de qué lo produjo.
//
// Acepta un `Date` real tal cual (nunca lo re-valida más allá de que
// no sea Invalid Date) — necesario porque muchos call-sites internos
// (tests, servicios) construyen el input con un Date de JS
// directamente en vez de pasar por un formulario; un string SOLO se
// acepta si es "YYYY-MM-DD" con mes/día reales para ese año (respeta
// bisiestos).
function parseCalendarDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

export function isValidDateOnlyString(value: string): boolean {
  return parseCalendarDateOnly(value) !== null;
}

export function dateOnlySchema(message = "Fecha inválida. Verifica día y mes.") {
  return z.union([
    z.date().refine((d) => !Number.isNaN(d.getTime()), message),
    z
      .string()
      .refine((v) => isValidDateOnlyString(v), message)
      .transform((v) => {
        const { year, month, day } = parseCalendarDateOnly(v)!;
        return new Date(Date.UTC(year, month - 1, day));
      }),
  ]);
}
