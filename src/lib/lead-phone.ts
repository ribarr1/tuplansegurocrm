// Normalización de teléfono para la Fábrica de leads — Fase 026.
//
// Deliberadamente NO reutiliza src/import/normalize.ts: ese módulo
// alimenta el pipeline de importación legacy (consumido también por
// src/import/matching.ts, book-of-business/*, y cubierto por sus
// propias pruebas); extraerlo o modificarlo arriesgaba cambiar su
// comportamiento para casos ya validados. Esta es una copia mínima e
// independiente de la misma lógica (solo dígitos, sin inventar ni
// truncar) para no acoplar ambos módulos.
//
// Solo para COMPARAR números ya existentes con distintos formatos —
// nunca para sobrescribir Person.phone ni hacer backfill masivo.
export function normalizeLeadPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits;
}
