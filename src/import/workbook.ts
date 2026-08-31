import ExcelJS from "exceljs";
import { isExcludedColumn, isExcludedSheet } from "./sensitive";

// Lectura segura de workbook — Fase 019. Toda lectura de celda pasa por
// aquí para poder garantizar en un solo lugar que una columna
// EXCLUDED_SENSITIVE nunca se lee más allá de "¿tiene valor o no?".

export async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export type SheetHandle = {
  name: string;
  headers: string[]; // header[i] = nombre de columna en índice 1-based i+1
  worksheet: ExcelJS.Worksheet;
};

export function getSheet(workbook: ExcelJS.Workbook, sheetName: string): SheetHandle | null {
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) return null;
  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });
  return { name: sheetName, headers, worksheet };
}

// Valor crudo de una celda, resolviendo fórmulas a su resultado
// calculado (nunca la fórmula en sí). No aplica ninguna clasificación
// de sensibilidad — usar rawCellByHeader/isRowExcluded para eso.
function rawCellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in v) {
    return (v as { result: unknown }).result;
  }
  if (v && typeof v === "object" && "richText" in v) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  return v;
}

export function cellByHeader(sheet: SheetHandle, row: ExcelJS.Row, header: string): unknown {
  if (isExcludedColumn(header)) {
    throw new Error(`Intento de leer columna excluida "${header}" — bug del importador, no del dato.`);
  }
  const colIndex = sheet.headers.indexOf(header);
  if (colIndex === -1) return undefined;
  return rawCellValue(row.getCell(colIndex + 1));
}

export function stringCell(sheet: SheetHandle, row: ExcelJS.Row, header: string): string | null {
  const v = cellByHeader(sheet, row, header);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Fechas en el workbook llegan a veces como Date (celda con formato de
// fecha real) y a veces como texto libre ("MM/DD/YYYY", "M/D/YY", etc.)
// — el source es inconsistente (ver inventario). Se intenta Date
// primero, luego un parseo tolerante de texto; si no se puede
// interpretar con confianza, se devuelve null y el llamador reporta un
// WARNING en vez de adivinar.
export function dateCell(sheet: SheetHandle, row: ExcelJS.Row, header: string): Date | null {
  const v = cellByHeader(sheet, row, header);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v).trim();
  if (s === "") return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const [, mm, dd] = m;
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = Number(yyyy) < 50 ? `20${yyyy}` : `19${yyyy}`;
    const month = Number(mm);
    const day = Number(dd);
    const year = Number(yyyy);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  return null;
}

// Montos: el source guarda "número como texto" en muchas filas (ver
// inventario: columnas con string+number mezclados). Se normaliza a un
// string decimal con punto, compatible con los schemas Zod existentes
// (regex \d+(\.\d{1,2})?) — nunca se opera con Number para el monto
// final, solo para el parseo de texto a string.
export function decimalCell(sheet: SheetHandle, row: ExcelJS.Row, header: string): string | null {
  const v = cellByHeader(sheet, row, header);
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v.toFixed(2) : null;
  }
  const s = String(v).trim().replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n).toFixed(2) : null;
}

export function rowCount(sheet: SheetHandle): number {
  let count = 0;
  sheet.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    let hasData = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== "") hasData = true;
    });
    if (hasData) count++;
  });
  return count;
}

// Cuenta cuántas filas de la hoja tienen al menos una columna
// EXCLUDED_SENSITIVE con valor — nunca expone cuáles ni sus valores.
export function countRowsWithExcludedData(sheet: SheetHandle): number {
  const excludedIndexes = sheet.headers
    .map((h, i) => (isExcludedColumn(h) ? i + 1 : -1))
    .filter((i) => i !== -1);
  if (excludedIndexes.length === 0) return 0;

  let count = 0;
  sheet.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const hasExcluded = excludedIndexes.some((i) => {
      const v = row.getCell(i).value;
      return v !== null && v !== undefined && v !== "";
    });
    if (hasExcluded) count++;
  });
  return count;
}

export { isExcludedSheet };
