import ExcelJS from "exceljs";
import { parseCsv } from "./csv";
import type { CommissionStatementAdapter, NormalizedCommissionRow, ParsedStatement } from "./types";

// ---------------------------------------------------------------------------
// Adapter Orange/Oscar — Fase 020 (§25).
//
// Formato real analizado: "REPORTE DE PAGO OSCAR AGOSTO ORANGE 2026",
// columnas: Member ID, Name, Agent, Sale Type, State, Type, Carrier,
// Status, Rate, Members, Subtotal, Asistencia, Total, Effective Date,
// Paid At.
//
// REGLA CONFIRMADA POR EL NEGOCIO (no inventada, no inferida):
//   receivedAmount = Subtotal
// NUNCA Total (Total = Subtotal - Asistencia; Asistencia se maneja en
// otro proceso, fuera de esta conciliación — ver
// docs/COMMISSION_RECONCILIATION.md).
//
// Se acepta CSV y XLSX (nunca PDF en esta fase — parsear PDF de forma
// robusta sin OCR ni posiciones visuales rígidas no es viable con la
// evidencia disponible; ver docs/COMMISSION_RECONCILIATION.md
// "Limitaciones del parser"). El archivo original NUNCA se persiste.
// ---------------------------------------------------------------------------

const REQUIRED_HEADERS = ["Member ID", "Name", "Subtotal"] as const;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers: string[], name: string): number {
  const target = normalizeHeader(name);
  return headers.findIndex((h) => normalizeHeader(h) === target);
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

// MM/DD/YYYY (formato US, consistente con el resto de la app — ver
// src/components/ui/us-date-input.tsx) — nunca DD/MM/YYYY. Devuelve
// una fecha ancla a medianoche UTC (mismo principio que el resto de
// columnas @db.Date del proyecto).
function parseUsDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function excelCellToDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === "string") return parseUsDate(value);
  return null;
}

function rowsFromTable(headers: string[], dataRows: string[][]): ParsedStatement {
  const missing = REQUIRED_HEADERS.filter((h) => findColumn(headers, h) === -1);
  if (missing.length > 0) {
    throw new Error(
      `El archivo no tiene el formato esperado de Orange/Oscar — faltan columnas: ${missing.join(", ")}.`
    );
  }

  const col = {
    memberId: findColumn(headers, "Member ID"),
    name: findColumn(headers, "Name"),
    agent: findColumn(headers, "Agent"),
    saleType: findColumn(headers, "Sale Type"),
    state: findColumn(headers, "State"),
    carrier: findColumn(headers, "Carrier"),
    status: findColumn(headers, "Status"),
    rate: findColumn(headers, "Rate"),
    members: findColumn(headers, "Members"),
    subtotal: findColumn(headers, "Subtotal"),
    effectiveDate: findColumn(headers, "Effective Date"),
    paidAt: findColumn(headers, "Paid At"),
  };

  const rows: NormalizedCommissionRow[] = [];
  let declaredTotal = 0;
  let hasDeclaredTotal = false;

  dataRows.forEach((cells, index) => {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").toString().trim() : "");
    const memberId = get(col.memberId);
    const name = get(col.name);
    const subtotalRaw = get(col.subtotal);
    // Fila sin Member ID ni Subtotal: probablemente una fila de
    // resumen/totales al final del reporte — se ignora silenciosamente
    // en vez de fallar todo el archivo, pero nunca se cuenta como fila
    // normalizada.
    if (!memberId && !name && !subtotalRaw) return;

    const receivedAmount = parseMoney(subtotalRaw);
    if (receivedAmount === null) {
      rows.push({
        source: "ORANGE_OSCAR",
        externalMemberId: memberId || null,
        memberName: name || null,
        sourceRowNumber: index + 1,
        receivedAmount: "0",
        agentName: get(col.agent) || null,
        saleType: get(col.saleType) || null,
        state: get(col.state) || null,
        carrier: get(col.carrier) || null,
        status: get(col.status) || null,
        rate: parseMoney(get(col.rate)),
        memberCount: parseInteger(get(col.members)),
        effectiveDate: null,
        paidAt: null,
      });
      return;
    }

    hasDeclaredTotal = true;
    declaredTotal += Number(receivedAmount);

    rows.push({
      source: "ORANGE_OSCAR",
      externalMemberId: memberId || null,
      memberName: name || null,
      agentName: get(col.agent) || null,
      saleType: get(col.saleType) || null,
      state: get(col.state) || null,
      carrier: get(col.carrier) || null,
      status: get(col.status) || null,
      rate: parseMoney(get(col.rate)),
      memberCount: parseInteger(get(col.members)),
      receivedAmount,
      effectiveDate: parseUsDate(get(col.effectiveDate)),
      paidAt: parseUsDate(get(col.paidAt)),
      sourceRowNumber: index + 1,
    });
  });

  return {
    rows,
    declaredTotal: hasDeclaredTotal ? declaredTotal.toFixed(2) : null,
  };
}

async function parseCsvBuffer(buffer: Buffer): Promise<ParsedStatement> {
  const text = buffer.toString("utf-8");
  const table = parseCsv(text);
  if (table.length === 0) {
    throw new Error("El archivo CSV está vacío.");
  }
  const [headers, ...dataRows] = table;
  return rowsFromTable(headers, dataRows);
}

async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedStatement> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo XLSX no tiene ninguna hoja.");

  const table: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    // ExcelJS es 1-indexed y `row.values` deja un hueco en el índice 0
    // — se recorre por celda real en vez de asumir un ancho fijo.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      const value = values[i];
      if (value instanceof Date) {
        const d = value;
        cells[i - 1] = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
      } else if (value && typeof value === "object" && "text" in (value as Record<string, unknown>)) {
        cells[i - 1] = String((value as { text: unknown }).text ?? "");
      } else {
        cells[i - 1] = value === null || value === undefined ? "" : String(value);
      }
    }
    table.push(cells);
  });
  if (table.length === 0) {
    throw new Error("El archivo XLSX no tiene filas.");
  }
  const [headers, ...dataRows] = table;
  return rowsFromTable(headers, dataRows);
}

export const OrangeOscarAdapter: CommissionStatementAdapter = {
  source: "ORANGE_OSCAR",
  label: "Orange / Oscar",
  acceptedExtensions: [".csv", ".xlsx"],
  async parse(buffer: Buffer, fileName: string): Promise<ParsedStatement> {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".xlsx")) return parseXlsxBuffer(buffer);
    if (lower.endsWith(".csv")) return parseCsvBuffer(buffer);
    throw new Error("Formato no soportado para Orange/Oscar — sube un archivo .csv o .xlsx.");
  },
};

// Reexportado por si algún test necesita la fecha sin pasar por todo
// el adapter.
export { parseUsDate as _parseUsDateForTests, excelCellToDate as _excelCellToDateForTests };
