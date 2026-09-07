// ---------------------------------------------------------------------------
// Fase 025.5.3 — el carrier de un reporte PDF se DETECTA del contenido,
// nunca se selecciona en la UI (ver docs/COMMISSION_RECONCILIATION.md).
// La UI solo elige agencia+modalidad (ORANGE_OWN, ORANGE_REFERRAL,
// ELITE_REFERRAL); el carrier real (Oscar, Ambetter, Kaiser, BCBS,
// Cigna, etc.) vive únicamente en el contenido de cada fila del PDF.
//
// Un reporte representa UN solo carrier — si aparece más de uno se
// bloquea la subida completa (nunca se adivina cuál es el "correcto").
// ---------------------------------------------------------------------------

// Normaliza para COMPARAR (nunca para mostrar): quita sufijos entre
// paréntesis (ej. "Oscar ( ACA)" -> "oscar"), colapsa espacios, minúsculas.
export function normalizeCarrierForComparison(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return cleaned || null;
}

export class MultipleCarriersError extends Error {}

// Recorre las filas ya normalizadas de un statement y confirma que
// TODAS comparten el mismo carrier (por comparación normalizada) —
// nunca se asume el primero visto ni se ignoran discrepancias. Devuelve
// el texto ORIGINAL (sin normalizar) de la primera aparición, para
// mostrarlo tal cual en el preview.
export function detectSingleCarrier(rows: { carrier?: string | null }[]): string | null {
  const seenByNormalized = new Map<string, string>();
  for (const row of rows) {
    const normalized = normalizeCarrierForComparison(row.carrier);
    if (!normalized) continue;
    if (!seenByNormalized.has(normalized)) {
      seenByNormalized.set(normalized, row.carrier!.trim());
    }
  }
  if (seenByNormalized.size > 1) {
    throw new MultipleCarriersError(
      `El reporte contiene más de un carrier (${[...seenByNormalized.values()].join(", ")}) — un reporte debe representar un único carrier. Revisa el archivo antes de subirlo de nuevo.`
    );
  }
  const [firstRaw] = seenByNormalized.values();
  return firstRaw ?? null;
}
