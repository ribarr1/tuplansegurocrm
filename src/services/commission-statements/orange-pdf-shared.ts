import { Prisma } from "@/generated/prisma/client";
import { extractPdfRows, tableFromRows, rowToRecord, type PdfTextRow } from "./pdf-table-extract";
import type { NormalizedCommissionRow, ParsedStatement } from "./types";

// ---------------------------------------------------------------------------
// Fase 025.5 — núcleo COMPARTIDO para los reportes PDF con el "estilo
// Orange" (Oscar propia, Kaiser referida, BCBS-vía-Orange propia — los
// 3 comparten prácticamente las mismas columnas, solo difieren en
// cuáles son opcionales: Member ID, Type, Comment). Nunca se duplica
// esta lógica entre OrangeOscarPdfAdapter/OrangeKaiserPdfAdapter — cada
// uno es una envoltura fina que fija agencia/modalidad y valida qué
// columnas espera encontrar.
// ---------------------------------------------------------------------------

const REQUIRED_HEADERS = [
  "Name",
  "Agent",
  "State",
  "Carrier",
  "Status",
  "Rate",
  "Members",
  "Subtotal",
  "Asistencia",
  "Total",
  "Effective Date",
  "Paid At",
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

// Estos reportes usan YYYY/MM/DD (Oscar/Kaiser/BCBS-Orange) — NUNCA el
// MM/DD/YYYY de la app o el formato de orange-oscar-adapter.ts (CSV,
// que sí es US) — cada adapter declara su propio formato de fecha
// real, nunca se asume que todos los reportes de "Orange" comparten
// el mismo. Ancla a medianoche UTC (mismo principio que el resto del
// proyecto para columnas de fecha pura).
function parseIsoOrderDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export interface OrangeStylePdfConfig {
  source: string;
  requireMemberId: boolean;
}

export async function parseOrangeStylePdf(buffer: Buffer, config: OrangeStylePdfConfig): Promise<ParsedStatement> {
  const extracted = await extractPdfRows(buffer);
  const requiredForThisConfig = config.requireMemberId ? ["Member ID", ...REQUIRED_HEADERS] : REQUIRED_HEADERS;
  const table = tableFromRows(extracted.rows, requiredForThisConfig);
  if (!table) {
    throw new Error(
      `El PDF no tiene el formato esperado — faltan columnas requeridas (${requiredForThisConfig.join(", ")}).`
    );
  }
  const headerCells = extracted.rows[table.headerRowIndex].cells;
  const headerByNormalized = new Map(headerCells.map((h) => [normalizeHeader(h.text), h.text]));
  function col(record: Record<string, string>, name: string): string | undefined {
    const real = headerByNormalized.get(normalizeHeader(name));
    return real ? record[real] : undefined;
  }

  const rows: NormalizedCommissionRow[] = [];
  let declaredFooterTotal: string | null = null;

  table.dataRows.forEach((row: PdfTextRow, index: number) => {
    const isFooterTotalRow = row.cells.some((c) => normalizeHeader(c.text) === "total");
    if (isFooterTotalRow) {
      const amountCell = [...row.cells].reverse().find((c) => parseMoney(c.text) !== null);
      declaredFooterTotal = amountCell ? parseMoney(amountCell.text) : declaredFooterTotal;
      return;
    }

    const { record, mismatched } = rowToRecord(row, headerCells);
    const warnings: string[] = [];
    if (mismatched) {
      warnings.push("Las columnas de esta fila no coincidieron 1:1 con el encabezado; se reconstruyeron por posición.");
    }

    const subtotal = parseMoney(col(record, "Subtotal"));
    const asistencia = parseMoney(col(record, "Asistencia")) ?? "0";
    const total = parseMoney(col(record, "Total"));
    if (subtotal !== null && total !== null) {
      const diff = new Prisma.Decimal(subtotal).minus(asistencia).minus(total).abs();
      if (diff.greaterThan("0.01")) {
        warnings.push(`Subtotal (${subtotal}) - Asistencia (${asistencia}) no coincide con Total (${total}).`);
      }
    }

    rows.push({
      source: config.source,
      externalMemberId: col(record, "Member ID") || null,
      memberName: col(record, "Name") || null,
      agentName: col(record, "Agent") || null,
      saleType: col(record, "Type") || null,
      state: col(record, "State") || null,
      carrier: col(record, "Carrier") || null,
      status: col(record, "Status") || null,
      rate: col(record, "Rate") || null,
      memberCount: parseInteger(col(record, "Members")),
      receivedAmount: subtotal ?? "0",
      assistanceAmount: asistencia,
      netAmount: total ?? subtotal ?? "0",
      effectiveDate: parseIsoOrderDate(col(record, "Effective Date")),
      paidAt: parseIsoOrderDate(col(record, "Paid At")),
      sourceRowNumber: index + 1,
      warnings,
    });
  });

  return { rows, declaredTotal: declaredFooterTotal };
}
