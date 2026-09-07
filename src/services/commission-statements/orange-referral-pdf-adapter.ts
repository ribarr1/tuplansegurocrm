import type { CommissionStatementAdapter, ParsedStatement } from "./types";
import { parseOrangeStylePdf } from "./orange-pdf-shared";

// ---------------------------------------------------------------------------
// Fase 025.5.3 — Orange, pólizas REFERIDAS (ORANGE_REFERRAL). Mismo
// criterio que OrangeOwnPdfAdapter: el ADMIN elige por AGENCIA+
// MODALIDAD, nunca por carrier — el carrier real (Kaiser, BCBS, etc.)
// se detecta del contenido y se muestra por separado en el preview.
// Reutiliza el MISMO parser que ORANGE_OWN (parseOrangeStylePdf) porque
// el layout de columnas es idéntico entre ambas modalidades — la única
// diferencia real observada entre archivos (si traen o no "Member ID")
// es una variante estructural que el parser ya detecta solo, nunca una
// distinción de negocio.
// ---------------------------------------------------------------------------

export const OrangeReferralPdfAdapter: CommissionStatementAdapter = {
  source: "ORANGE_REFERRAL",
  label: "Orange — Referidas",
  acceptedExtensions: [".pdf"],
  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const parsed = await parseOrangeStylePdf(buffer, { source: "ORANGE_REFERRAL" });
    return { ...parsed, payerAgency: "ORANGE", businessModality: "REFERRAL", adapterVersion: "2", policyType: "HEALTH" };
  },
};
