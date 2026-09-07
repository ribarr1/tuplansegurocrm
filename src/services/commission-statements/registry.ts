import type { CommissionStatementAdapter } from "./types";
import { OrangeOscarAdapter } from "./orange-oscar-adapter";
import { OrangeOwnPdfAdapter } from "./orange-own-pdf-adapter";
import { OrangeReferralPdfAdapter } from "./orange-referral-pdf-adapter";
import { EliteReferralPdfAdapter } from "./elite-referral-pdf-adapter";
import { PendingPdfAdapters } from "./pending-pdf-adapter";

// Único lugar donde se registran los adapters disponibles — agregar
// una agencia nueva es agregar una entrada aquí, nunca tocar
// reconciliation.service.ts (ver docs/COMMISSION_RECONCILIATION.md).
//
// Fase 025.5.3: el selector de fuente elige AGENCIA+MODALIDAD
// (ORANGE_OWN, ORANGE_REFERRAL, ELITE_REFERRAL) — nunca un carrier. El
// carrier real se detecta del contenido del PDF (ver
// carrier-detection.ts), nunca se expone como una opción distinta aquí.
// Agregar soporte a un carrier nuevo bajo una modalidad ya existente NO
// requiere una entrada nueva en este registro (el parser ya la acepta),
// solo si aparece una AGENCIA o MODALIDAD nueva.
export const STATEMENT_ADAPTERS: Record<string, CommissionStatementAdapter> = {
  [OrangeOscarAdapter.source]: OrangeOscarAdapter,
  [OrangeOwnPdfAdapter.source]: OrangeOwnPdfAdapter,
  [OrangeReferralPdfAdapter.source]: OrangeReferralPdfAdapter,
  [EliteReferralPdfAdapter.source]: EliteReferralPdfAdapter,
  ...Object.fromEntries(PendingPdfAdapters.map((a) => [a.source, a])),
};

export function getStatementAdapter(source: string): CommissionStatementAdapter | null {
  return STATEMENT_ADAPTERS[source] ?? null;
}

// Fase 025.5.5 (UAT-20): `ORANGE_OSCAR` es la fuente legacy CSV/XLSX de
// Fase 020 — debe seguir resolviéndose vía `getStatementAdapter` para
// interpretar reportes históricos ya existentes, pero NUNCA debe
// aparecer como opción para NUEVAS importaciones (el selector de
// subida solo ofrece las 3 modalidades agencia+PDF vigentes). Por eso
// el default de `includeLegacy` es `false`: cualquier caller nuevo que
// no pase el parámetro obtiene el comportamiento seguro (sin la fuente
// legacy); solo se pasa `true` explícitamente donde de verdad se
// necesita listar/inspeccionar la fuente legacy.
export function listStatementSources(
  { includeLegacy = false }: { includeLegacy?: boolean } = {}
): { source: string; label: string }[] {
  return Object.values(STATEMENT_ADAPTERS)
    .filter((a) => includeLegacy || a.source !== OrangeOscarAdapter.source)
    .map((a) => ({ source: a.source, label: a.label }));
}
