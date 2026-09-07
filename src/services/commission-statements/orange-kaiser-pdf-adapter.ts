import type { CommissionStatementAdapter, ParsedStatement } from "./types";
import { parseOrangeStylePdf } from "./orange-pdf-shared";

// ---------------------------------------------------------------------------
// Fase 025.5 — Orange / Kaiser, pólizas REFERIDAS (ORANGE_REFERRAL).
// Formato real analizado: Name, Agent, State, Type, Carrier, Status,
// Rate, Members, Subtotal, Asistencia, Total, Effective Date, Paid At
// — SIN Member ID (a diferencia de Oscar). El matching para este
// adapter es necesariamente más cauteloso (nombre + carrier + estado +
// fecha efectiva, nunca solo nombre) porque no hay ningún identificador
// de miembro en el archivo — ver matcher.ts.
//
// Modalidad (REFERRAL) y agencia (ORANGE) se fijan aquí — el ejemplo
// confirmado de negocio es "Kaiser en Georgia, sin contrato directo,
// pagado por Orange como referida", pero el adapter nunca asume que
// TODO reporte de Kaiser es referido, ni que solo Kaiser puede usar
// este adapter — es la ausencia de Member ID + la selección explícita
// del ADMIN en la subida lo que determina esto, nunca el nombre del
// carrier dentro del archivo.
// ---------------------------------------------------------------------------

export const OrangeKaiserPdfAdapter: CommissionStatementAdapter = {
  source: "ORANGE_KAISER_PDF",
  label: "Orange — Kaiser (PDF, referida)",
  acceptedExtensions: [".pdf"],
  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const parsed = await parseOrangeStylePdf(buffer, { source: "ORANGE_KAISER_PDF", requireMemberId: false });
    return { ...parsed, payerAgency: "ORANGE", businessModality: "REFERRAL", adapterVersion: "1", policyType: "HEALTH" };
  },
};
