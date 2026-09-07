import { Prisma } from "@/generated/prisma/client";
import { extractPdfRows, tableFromRows, rowToRecord, detectFooterTotal, PdfFormatMismatchError } from "./pdf-table-extract";
import { detectSingleCarrier } from "./carrier-detection";
import type { CommissionStatementAdapter, NormalizedCommissionRow, ParsedStatement } from "./types";

// ---------------------------------------------------------------------------
// Fase 025.5.3 — Elite, pólizas REFERIDAS (ELITE_REFERRAL). El ADMIN
// elige esta fuente por AGENCIA+MODALIDAD, nunca por carrier — Elite en
// este proyecto solo paga referidas (nunca propias), pero el carrier
// real (BCBS, u otro que Elite llegue a pagar) se detecta del contenido
// de cada fila y se muestra por separado en el preview, nunca se
// mezcla con la selección de agencia/modalidad.
//
// Formato real analizado (DISTINTO del estilo Orange, nunca reutiliza
// orange-pdf-shared.ts): REPORT, CARRIER, MEMBER ID, Agent,
// CLIENT/TITLE, CLIENT DOB, STATE, RATE, EFFECTIVE DATE, APPLICANTS,
// SUBTOTAL, ASISTENCIA, TOTAL, MONTH PAID. Sin columna Status.
//
// CLIENT DOB es PII (fecha de nacimiento) — se usa EXCLUSIVAMENTE en
// memoria como señal adicional de matching (nombre + DOB + carrier +
// estado, ver matcher.ts) y NUNCA se persiste en CommissionStatementRow
// ni en ningún log/AuditEvent — `dateOfBirth` en NormalizedCommissionRow
// existe solo para ese propósito transitorio.
// ---------------------------------------------------------------------------

const REQUIRED_HEADERS = [
  "REPORT",
  "CARRIER",
  "MEMBER ID",
  "Agent",
  "CLIENT/TITLE",
  "CLIENT DOB",
  "STATE",
  "RATE",
  "EFFECTIVE DATE",
  "APPLICANTS",
  "SUBTOTAL",
  "ASISTENCIA",
  "TOTAL",
  "MONTH PAID",
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMoney(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

function parseInteger(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

// YYYY-MM-DD (confirmado en el archivo real, tanto EFFECTIVE DATE/
// MONTH PAID como CLIENT DOB) — ancla a medianoche UTC.
function parseIsoDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export const EliteReferralPdfAdapter: CommissionStatementAdapter = {
  source: "ELITE_REFERRAL",
  label: "Elite — Referidas",
  acceptedExtensions: [".pdf"],
  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const extracted = await extractPdfRows(buffer);
    const table = tableFromRows(extracted.rows, REQUIRED_HEADERS);
    if (!table) {
      throw new PdfFormatMismatchError(
        `El PDF no tiene el formato esperado de Elite — faltan columnas requeridas (${REQUIRED_HEADERS.join(", ")}).`
      );
    }
    const headerCells = extracted.rows[table.headerRowIndex].cells;
    const headerByNormalized = new Map(headerCells.map((h) => [normalizeHeader(h.text), h.text]));
    function col(record: Record<string, string>, name: string): string | undefined {
      const real = headerByNormalized.get(normalizeHeader(name));
      return real ? record[real] : undefined;
    }

    const { declaredTotal: declaredFooterTotal, totalRowIndices } = detectFooterTotal(
      table.dataRows,
      (text) => normalizeHeader(text) === "total",
      parseMoney
    );

    const rows: NormalizedCommissionRow[] = [];

    table.dataRows.forEach((row, index) => {
      if (totalRowIndices.has(index)) return;

      const { record, mismatched } = rowToRecord(row, headerCells);
      const warnings: string[] = [];
      if (mismatched) {
        warnings.push("Las columnas de esta fila no coincidieron 1:1 con el encabezado; se reconstruyeron por posición.");
      }

      const subtotal = parseMoney(col(record, "SUBTOTAL"));
      const asistencia = parseMoney(col(record, "ASISTENCIA")) ?? "0";
      const total = parseMoney(col(record, "TOTAL"));
      if (subtotal !== null && total !== null) {
        const diff = new Prisma.Decimal(subtotal).minus(asistencia).minus(total).abs();
        if (diff.greaterThan("0.01")) {
          warnings.push(`Subtotal (${subtotal}) - Asistencia (${asistencia}) no coincide con Total (${total}).`);
        }
      }

      rows.push({
        source: "ELITE_REFERRAL",
        externalMemberId: col(record, "MEMBER ID") || null,
        memberName: col(record, "CLIENT/TITLE") || null,
        agentName: col(record, "Agent") || null,
        state: col(record, "STATE") || null,
        carrier: col(record, "CARRIER") || null,
        status: null, // este formato no reporta Status
        rate: col(record, "RATE") || null,
        memberCount: parseInteger(col(record, "APPLICANTS")),
        receivedAmount: subtotal ?? "0",
        assistanceAmount: asistencia,
        netAmount: total ?? subtotal ?? "0",
        effectiveDate: parseIsoDate(col(record, "EFFECTIVE DATE")),
        paidAt: parseIsoDate(col(record, "MONTH PAID")),
        dateOfBirth: parseIsoDate(col(record, "CLIENT DOB")),
        sourceRowNumber: index + 1,
        warnings,
      });
    });

    const detectedCarrierRaw = detectSingleCarrier(rows);

    return {
      rows,
      declaredTotal: declaredFooterTotal,
      payerAgency: "ELITE",
      businessModality: "REFERRAL",
      adapterVersion: "2",
      policyType: "HEALTH",
      detectedCarrierRaw,
    };
  },
};
