// ---------------------------------------------------------------------------
// Conciliación de comisiones — Fase 020 (§7-§26 de la ficha).
//
// Un CommissionStatementAdapter transforma el formato externo de una
// agencia/upline concreta a este DTO común — nunca hay lógica
// específica de una agencia ("if Orange Oscar then...") mezclada
// dentro de reconciliation.service.ts ni de commissions.service.ts.
// Ver docs/COMMISSION_RECONCILIATION.md para el detalle completo.
// ---------------------------------------------------------------------------

// receivedAmount es SIEMPRE el monto que debe entrar a
// CommissionPayment — cada adapter decide qué columna de su formato
// corresponde a esto (para Orange/Oscar: Subtotal, nunca Total, ver
// docs/COMMISSION_RECONCILIATION.md). String decimal (nunca number),
// mismo principio que el resto de montos financieros del proyecto.
export interface NormalizedCommissionRow {
  source: string;
  externalMemberId?: string | null;
  memberName?: string | null;
  agentName?: string | null;
  saleType?: string | null;
  state?: string | null;
  carrier?: string | null;
  status?: string | null;
  rate?: string | null;
  memberCount?: number | null;
  receivedAmount: string;
  effectiveDate?: Date | null;
  paidAt?: Date | null;
  sourceRowNumber: number;
}

export interface ParsedStatement {
  rows: NormalizedCommissionRow[];
  // Total tal como lo reporta el archivo, si es calculable de forma
  // segura — usado solo para mostrarlo en el preview, nunca como
  // fuente de verdad (el total real siempre se deriva sumando
  // receivedAmount de las filas ya normalizadas).
  declaredTotal?: string | null;
}

export interface CommissionStatementAdapter {
  // Identificador estable (persistido en CommissionStatement.source) —
  // string libre, mismo criterio que AuditEvent.action: el catálogo de
  // fuentes crece por configuración, no por migración.
  source: string;
  label: string;
  // Extensiones de archivo que este adapter acepta — usado para
  // validar antes de intentar parsear (ver file-security en
  // reconciliation.service.ts).
  acceptedExtensions: readonly string[];
  parse(buffer: Buffer, fileName: string): Promise<ParsedStatement>;
}
