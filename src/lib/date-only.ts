// Helpers para columnas @db.Date (ej. Person.dateOfBirth). Prisma
// entrega estas columnas como un Date de JS anclado a medianoche UTC
// del día calendario real — nunca leerlas con los getters LOCALES
// (.getFullYear()/.getMonth()/.getDate()), que dependen de la zona
// horaria del proceso y pueden mostrar el día ANTERIOR si el proceso
// corre en una zona con offset negativo respecto a UTC. Los getters
// UTC son la única lectura segura para un valor que es una fecha pura,
// no un instante.

export function getDateOnlyParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

// Hallazgo adicional de UAT (Fase 019.7): el CRM se usa principalmente
// en EE. UU. — toda fecha visible al usuario debe mostrarse MM/DD/YYYY
// (ej. "09/01/2026"), nunca DD/MM/YYYY ni un formato escrito en
// español. Esto es SOLO presentación — el almacenamiento en DB sigue
// siendo ISO (@db.Date, ancla a medianoche UTC); nunca se cambia eso.
// Para una columna @db.Date, se usan los getters UTC (igual que
// getDateOnlyParts) — nunca un Intl.DateTimeFormat con otra zona
// horaria, que podría mostrar el día equivocado para una fecha pura.
export function formatDateOnlyUS(date: Date | null | undefined): string {
  if (!date) return "—";
  const { year, month, day } = getDateOnlyParts(date);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

// Hallazgo #16 de UAT (Fase 019.8): el navegador decide el formato
// visual de <input type="date"> según su propio locale/SO — puede
// mostrar dd/mm/aaaa aunque la etiqueta diga MM/DD/AAAA. Estas
// funciones puras respaldan <USDateInput> (src/components/ui/
// us-date-input.tsx), que reemplaza el input nativo por un campo de
// texto enmascarado MM/DD/AAAA + un input oculto que sigue enviando
// el mismo string YYYY-MM-DD que ya esperaban los schemas/Server
// Actions — cero cambios de contrato en el resto de la aplicación.

// Días reales del mes (respeta bisiestos) sin necesitar isLeapYear
// directamente: el día 0 del mes siguiente es el último día de este.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Reconstruye el string MM/DD/AAAA insertando las barras automáticamente
// a partir de los dígitos que el usuario ya escribió — funciona igual
// para escritura progresiva, pegado de texto completo, y borrado
// (Backspace elimina un dígito o una barra, en ambos casos el string de
// dígitos resultante se recalcula desde cero, nunca se edita in-place).
export function maskUsDate(rawInput: string): string {
  const digits = rawInput.replace(/\D/g, "").slice(0, 8);
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  let out = mm;
  if (digits.length > 2) out += `/${dd}`;
  if (digits.length > 4) out += `/${yyyy}`;
  return out;
}

// MM/DD/AAAA (completo, 4 dígitos de año) -> YYYY-MM-DD, o "" si el
// string todavía está incompleto o no es una fecha real (mes 00/13,
// día 00/30 de febrero, etc.) — nunca lanza, se usa en cada tecleo.
export function usDateToIso(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > daysInMonth(year, month)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// YYYY-MM-DD -> MM/DD/AAAA, para precargar <USDateInput> con un valor
// ya guardado (ej. defaultValue de un formulario de edición).
export function isoToUsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Convención Fase 015 para nacidos el 29 de febrero: en un año no
// bisiesto, el cumpleaños operativo (para "hoy"/"próximos"/recordatorios)
// se celebra el 28 de febrero — dateOfBirth nunca se modifica, esto solo
// decide qué día usar al comparar/calcular la ocurrencia de un año dado.
export function effectiveBirthdayForYear(
  month: number,
  day: number,
  year: number
): { month: number; day: number } {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return { month: 2, day: 28 };
  }
  return { month, day };
}
