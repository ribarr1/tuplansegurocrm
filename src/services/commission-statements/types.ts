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
//
// Fase 025.5: assistanceAmount/netAmount son informativos (preview y
// reportes) — NUNCA generan su propio CommissionPayment (Asistencia es
// un gasto separado, nunca un chargeback ni una reducción de lo
// esperado). dateOfBirth NUNCA se persiste (solo existe en memoria
// durante el matching de un adapter como Elite/BCBS que sí trae DOB en
// el archivo) — ver docs/COMMISSION_RECONCILIATION.md.
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
  assistanceAmount?: string | null;
  netAmount?: string | null;
  effectiveDate?: Date | null;
  paidAt?: Date | null;
  sourceRowNumber: number;
  // Solo en memoria durante esta importación — nunca se guarda en
  // CommissionStatementRow ni en ningún log/AuditEvent (ver
  // matcher.ts, único consumidor).
  dateOfBirth?: Date | null;
  // Advertencias no bloqueantes del adapter (ej. Subtotal-Asistencia
  // != Total con una diferencia de redondeo) — nunca contienen PII.
  warnings?: string[];
}

export interface ParsedStatement {
  rows: NormalizedCommissionRow[];
  // Total tal como lo reporta el archivo, si es calculable de forma
  // segura — usado solo para mostrarlo en el preview, nunca como
  // fuente de verdad (el total real siempre se deriva sumando
  // receivedAmount de las filas ya normalizadas).
  declaredTotal?: string | null;
  // Fase 025.5: metadatos de clasificación fijados por el adapter
  // (nunca inferidos del carrier de cada fila individual) — ORANGE_OWN
  // fija payerAgency=ORANGE/businessModality=OWN, etc. Adapters CSV/
  // XLSX de Fase 020 los dejan undefined (fuera de alcance de esta fase).
  payerAgency?: "ORANGE" | "ELITE";
  businessModality?: "OWN" | "REFERRAL";
  adapterVersion?: string;
  // Fase 025.5: los 3 adaptadores PDF reales son EXCLUSIVAMENTE de
  // comisiones HEALTH — se fija aquí (nunca inferido) para que el
  // matcher nunca pueda emparejar una fila con una póliza de otro
  // producto (ver matcher.ts).
  policyType?: "HEALTH";
  // Fase 025.5.3: el carrier real se DETECTA del contenido del PDF
  // (columna Carrier de cada fila), nunca se selecciona en la UI — la
  // UI solo elige agencia+modalidad. Texto tal como aparece en el
  // archivo (ej. "Oscar ( ACA)"), para mostrarlo en el preview; nunca
  // se usa para inferir OWN/REFERRAL. Un reporte con más de un carrier
  // distinto hace que el adapter rechace el archivo por completo (ver
  // carrier-detection.ts) — nunca llega aquí con ambigüedad.
  detectedCarrierRaw?: string | null;
  // Fase 1.1 (UAT real "OSCAR MARZO (1)"): cuando el archivo trae más
  // de un bloque/tabla independiente en la misma página (cada uno con
  // su propio footer "Total"), `declaredTotal` ya es la SUMA de todos
  // los bloques (ver detectFooterTotal) — pero eso no basta: un error
  // que se cancele entre dos bloques (uno de más, otro de menos)
  // pasaría inadvertido si solo se valida el combinado. `footerBlocks`
  // trae el detalle de CADA bloque (su total declarado y la suma real
  // de netAmount de sus filas) para que reconciliation.service.ts
  // valide AMBOS niveles — nunca solo el combinado. Undefined/vacío
  // para reportes de un solo bloque (comportamiento previo, sin
  // cambios) o adapters que no traen bloques (CSV/XLSX de Fase 020).
  footerBlocks?: { declaredTotal: string; actualNetSum: string }[];
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
