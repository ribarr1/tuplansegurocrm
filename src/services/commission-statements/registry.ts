import type { CommissionStatementAdapter } from "./types";
import { OrangeOscarAdapter } from "./orange-oscar-adapter";

// Único lugar donde se registran los adapters disponibles — agregar
// una agencia nueva es agregar una entrada aquí, nunca tocar
// reconciliation.service.ts (ver docs/COMMISSION_RECONCILIATION.md).
export const STATEMENT_ADAPTERS: Record<string, CommissionStatementAdapter> = {
  [OrangeOscarAdapter.source]: OrangeOscarAdapter,
};

export function getStatementAdapter(source: string): CommissionStatementAdapter | null {
  return STATEMENT_ADAPTERS[source] ?? null;
}

export function listStatementSources(): { source: string; label: string }[] {
  return Object.values(STATEMENT_ADAPTERS).map((a) => ({ source: a.source, label: a.label }));
}
