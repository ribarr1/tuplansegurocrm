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

export function listStatementSources(): { source: string; label: string }[] {
  return Object.values(STATEMENT_ADAPTERS).map((a) => ({ source: a.source, label: a.label }));
}
