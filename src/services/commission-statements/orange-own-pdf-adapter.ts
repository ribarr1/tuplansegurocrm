import type { CommissionStatementAdapter, ParsedStatement } from "./types";
import { parseOrangeStylePdf } from "./orange-pdf-shared";

// ---------------------------------------------------------------------------
// Fase 025.5.3 — Orange, pólizas PROPIAS (ORANGE_OWN). El ADMIN elige
// esta fuente por AGENCIA+MODALIDAD, nunca por carrier — el mismo
// selector sirve para un reporte de Oscar, Ambetter o cualquier otro
// carrier que Orange pague como propia; el carrier real se detecta del
// contenido del PDF (ver orange-pdf-shared.ts/carrier-detection.ts) y
// se muestra por separado en el preview, nunca se mezcla con esta
// selección (ver docs/COMMISSION_RECONCILIATION.md).
//
// Modalidad (OWN) y agencia (ORANGE) se fijan aquí, en el adapter —
// NUNCA se infieren del carrier de cada fila.
// ---------------------------------------------------------------------------

export const OrangeOwnPdfAdapter: CommissionStatementAdapter = {
  source: "ORANGE_OWN",
  label: "Orange — Propias",
  acceptedExtensions: [".pdf"],
  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const parsed = await parseOrangeStylePdf(buffer, { source: "ORANGE_OWN" });
    return { ...parsed, payerAgency: "ORANGE", businessModality: "OWN", adapterVersion: "2", policyType: "HEALTH" };
  },
};
