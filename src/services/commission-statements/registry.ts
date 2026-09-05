import type { CommissionStatementAdapter } from "./types";
import { OrangeOscarAdapter } from "./orange-oscar-adapter";
import { PendingPdfAdapters } from "./pending-pdf-adapter";

// Único lugar donde se registran los adapters disponibles — agregar
// una agencia nueva es agregar una entrada aquí, nunca tocar
// reconciliation.service.ts (ver docs/COMMISSION_RECONCILIATION.md).
//
// Fase 025.4 (UAT-05): los *_PDF son adaptadores "pendientes" — ya
// aceptan el upload de un PDF real (validado por firma, nunca solo
// extensión) pero su `parse()` rechaza explícitamente hasta contar con
// un PDF representativo real de esa fuente (ver pending-pdf-adapter.ts
// para el porqué). Reemplazar cada entrada por un adaptador real
// cuando exista esa muestra — nunca antes.
export const STATEMENT_ADAPTERS: Record<string, CommissionStatementAdapter> = {
  [OrangeOscarAdapter.source]: OrangeOscarAdapter,
  ...Object.fromEntries(PendingPdfAdapters.map((a) => [a.source, a])),
};

export function getStatementAdapter(source: string): CommissionStatementAdapter | null {
  return STATEMENT_ADAPTERS[source] ?? null;
}

export function listStatementSources(): { source: string; label: string }[] {
  return Object.values(STATEMENT_ADAPTERS).map((a) => ({ source: a.source, label: a.label }));
}
