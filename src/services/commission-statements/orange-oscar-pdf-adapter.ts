import type { CommissionStatementAdapter, ParsedStatement } from "./types";
import { parseOrangeStylePdf } from "./orange-pdf-shared";

// ---------------------------------------------------------------------------
// Fase 025.5 — Orange / Oscar, pólizas PROPIAS (ORANGE_OWN). Formato
// real analizado: Member ID, Name, Agent, State, Carrier, Status, Rate,
// Members, Subtotal, Asistencia, Total, Effective Date, Paid At,
// Comment. Trae Member ID siempre (a diferencia de Kaiser) — se exige
// como columna requerida para detectar el formato correcto; NUNCA se
// asume que Member ID equivale a Policy Number (ver matcher.ts).
//
// Modalidad (OWN) y agencia (ORANGE) se fijan aquí, en el adapter —
// NUNCA se infieren del carrier de cada fila (Oscar es la muestra
// inicial de ORANGE_OWN, pero un futuro reporte de otro carrier bajo
// esta misma modalidad usaría este mismo adapter genérico, ver
// docs/COMMISSION_RECONCILIATION.md).
// ---------------------------------------------------------------------------

export const OrangeOscarPdfAdapter: CommissionStatementAdapter = {
  source: "ORANGE_OSCAR_PDF",
  label: "Orange — Oscar (PDF, propia)",
  acceptedExtensions: [".pdf"],
  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const parsed = await parseOrangeStylePdf(buffer, { source: "ORANGE_OSCAR_PDF", requireMemberId: true });
    return { ...parsed, payerAgency: "ORANGE", businessModality: "OWN", adapterVersion: "1", policyType: "HEALTH" };
  },
};
