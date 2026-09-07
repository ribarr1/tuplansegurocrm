import type { CommissionStatementAdapter } from "./types";
import { OrangeOscarAdapter } from "./orange-oscar-adapter";
import { OrangeOscarPdfAdapter } from "./orange-oscar-pdf-adapter";
import { OrangeKaiserPdfAdapter } from "./orange-kaiser-pdf-adapter";
import { EliteBcbsPdfAdapter } from "./elite-bcbs-pdf-adapter";
import { PendingPdfAdapters } from "./pending-pdf-adapter";

// Único lugar donde se registran los adapters disponibles — agregar
// una agencia nueva es agregar una entrada aquí, nunca tocar
// reconciliation.service.ts (ver docs/COMMISSION_RECONCILIATION.md).
//
// Fase 025.5: 3 adaptadores PDF REALES (Orange/Oscar propia, Orange/
// Kaiser referida, Elite/BCBS referida) + los que siguen pendientes
// (ver pending-pdf-adapter.ts) por falta de un PDF de muestra real.
export const STATEMENT_ADAPTERS: Record<string, CommissionStatementAdapter> = {
  [OrangeOscarAdapter.source]: OrangeOscarAdapter,
  [OrangeOscarPdfAdapter.source]: OrangeOscarPdfAdapter,
  [OrangeKaiserPdfAdapter.source]: OrangeKaiserPdfAdapter,
  [EliteBcbsPdfAdapter.source]: EliteBcbsPdfAdapter,
  ...Object.fromEntries(PendingPdfAdapters.map((a) => [a.source, a])),
};

export function getStatementAdapter(source: string): CommissionStatementAdapter | null {
  return STATEMENT_ADAPTERS[source] ?? null;
}

export function listStatementSources(): { source: string; label: string }[] {
  return Object.values(STATEMENT_ADAPTERS).map((a) => ({ source: a.source, label: a.label }));
}
