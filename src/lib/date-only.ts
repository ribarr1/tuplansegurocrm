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
