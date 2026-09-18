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

// Fase 1.1 — variantes reales confirmadas de Blue Cross Blue Shield que
// NO normalizan igual que el nombre canónico del catálogo
// ("BLUE CROSS BLUE SHIELD (BCBS)") solo quitando paréntesis: a un
// adapter le falta "Shield", a otro le sobra "and". Autorizado por el
// usuario tras revisar los archivos reales (Fase 1.1, UAT "carrier no
// reconocido"). Nunca se adivina una variante nueva no confirmada —
// solo estas 2 formas reales se mapean explícitamente; "Blue Cross
// Blue Shield (ACA)" ya normaliza igual que el canónico sin necesidad
// de alias (el sufijo entre paréntesis ya se quita arriba).
// Fase 1.1 — "Kaiser" (reportado tal cual, sin "Permanente", en 4
// archivos reales de Kaiser) autorizado por el usuario como alias
// EXACTO hacia el nombre canónico del catálogo ("KAISER PERMANENTE").
// Coincidencia de clave EXACTA sobre el texto ya limpiado (nunca
// fuzzy/substring) — "Kaiser Foundation", "Kaiser SC" o cualquier otro
// texto que solo CONTENGA "kaiser" nunca calza esta clave y sigue
// normalizando a su propio valor distinto, sin alias.
const CARRIER_ALIASES: Record<string, string> = {
  "blue cross and blue shield": "blue cross blue shield",
  "blue cross blue": "blue cross blue shield",
  kaiser: "kaiser permanente",
};

// Normaliza para COMPARAR (nunca para mostrar): quita sufijos entre
// paréntesis (ej. "Oscar ( ACA)" -> "oscar"), colapsa espacios, minúsculas,
// y resuelve alias de carrier reales confirmados (ver CARRIER_ALIASES).
export function normalizeCarrierForComparison(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  return CARRIER_ALIASES[cleaned] ?? cleaned;
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
