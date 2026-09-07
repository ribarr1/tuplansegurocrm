import "server-only";

// ---------------------------------------------------------------------------
// Fase 025.5 (UAT-05, importación real) — extracción de texto posicional
// de un PDF tabular (Orange/Oscar, Orange/Kaiser, Elite/BCBS y
// variantes futuras del mismo estilo). Usa pdfjs-dist (Mozilla, sin
// dependencias nativas para extracción de texto — nunca renderiza a
// imagen, nunca ejecuta JavaScript embebido del PDF, nunca confía en
// metadata del documento). Ver docs/COMMISSION_RECONCILIATION.md para
// la evaluación de la librería antes de agregarla.
//
// Solo se usa getDocument+getTextContent — nunca se activa scripting de
// formularios/anotaciones (una opción aparte, no usada aquí) ni se
// renderiza a imagen, así que un PDF con JavaScript embebido nunca se
// ejecuta por este código.
//
// Cada celda de estas tablas llega como UN fragmento de texto propio
// (confirmado contra los 3 PDF reales analizados) — nunca se reconstruye
// una fila concatenando texto por posición de carácter, que sería frágil.
// Las filas se agrupan por coordenada Y con una tolerancia (algunas
// filas reales tienen un fragmento —típicamente "Agent"— desalineado
// verticalmente por 1pt respecto al resto de la fila) — nunca se asume
// una alineación perfecta.
// ---------------------------------------------------------------------------

export const MAX_PDF_PAGES = 20;
const ROW_Y_GAP_THRESHOLD = 4; // pt — separación mínima real entre filas distintas en estos reportes (~12pt)

export interface PdfTextRow {
  y: number;
  cells: { text: string; x: number }[];
}

export interface ExtractedPdfTable {
  pageCount: number;
  rows: PdfTextRow[];
}

export class PdfTooManyPagesError extends Error {}
export class PdfParseError extends Error {}

export async function extractPdfRows(buffer: Buffer): Promise<ExtractedPdfTable> {
  // Import diferido: pdfjs-dist es relativamente pesado, nunca se carga
  // fuera del flujo real de importación de comisiones.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    throw new PdfParseError(
      `No se pudo leer el archivo PDF (¿está dañado, cifrado, o no es un PDF real?): ${
        error instanceof Error ? error.message : "error desconocido"
      }`
    );
  }

  if (doc.numPages > MAX_PDF_PAGES) {
    throw new PdfTooManyPagesError(
      `El PDF tiene ${doc.numPages} páginas — el máximo permitido es ${MAX_PDF_PAGES}.`
    );
  }

  const allItems: { text: string; x: number; y: number }[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      // TextItem siempre trae `str`; TextMarkedContent (raro, sin texto
      // real) no — se descarta con un narrowing explícito, nunca `any`.
      if (!("str" in raw)) continue;
      const text = raw.str.trim();
      if (!text) continue;
      allItems.push({ text, x: raw.transform[4], y: raw.transform[5] });
    }
  }

  // Clustering por Y con tolerancia — nunca redondeo simple (ver
  // comentario de arriba, causaba una fila real partida en dos).
  allItems.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextRow[] = [];
  for (const item of allItems) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && lastRow.y - item.y <= ROW_Y_GAP_THRESHOLD) {
      lastRow.cells.push({ text: item.text, x: item.x });
      lastRow.cells.sort((a, b) => a.x - b.x);
    } else {
      rows.push({ y: item.y, cells: [{ text: item.text, x: item.x }] });
    }
  }

  return { pageCount: doc.numPages, rows };
}

// Convierte filas posicionales en una tabla headers+dataRows, usando la
// PRIMERA fila que contenga TODOS los encabezados requeridos (nunca
// asume que es la fila 0 — algunos reportes podrían tener un título
// arriba). Filas de datos con el MISMO número de celdas que el header
// se mapean por posición (1:1, ya confirmado que cada celda es un
// fragmento propio); una fila con un número distinto de celdas se
// reconstruye por cercanía a la posición X de cada columna del header
// — nunca se descarta silenciosamente, se reporta como advertencia por
// el caller.
export function tableFromRows(
  rows: PdfTextRow[],
  requiredHeaders: readonly string[]
): { headerRowIndex: number; headers: string[]; dataRows: PdfTextRow[] } | null {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const requiredNormalized = requiredHeaders.map(normalize);

  const headerRowIndex = rows.findIndex((row) => {
    const rowTexts = row.cells.map((c) => normalize(c.text));
    return requiredNormalized.every((h) => rowTexts.includes(h));
  });
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].cells.map((c) => c.text);
  const dataRows = rows.slice(headerRowIndex + 1);
  return { headerRowIndex, headers, dataRows };
}

// Fila -> Record<header, valor>. Si el conteo de celdas coincide con el
// header, mapeo posicional directo (caso normal). Si no coincide, cada
// celda se asigna a la columna de header más cercana en X — nunca se
// trunca ni se ignora una celda extra en silencio, se reporta aparte.
export function rowToRecord(
  row: PdfTextRow,
  headers: { text: string; x: number }[]
): { record: Record<string, string>; mismatched: boolean } {
  if (row.cells.length === headers.length) {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h.text] = row.cells[i].text;
    });
    return { record, mismatched: false };
  }

  const record: Record<string, string> = {};
  for (const cell of row.cells) {
    let nearest = headers[0];
    let nearestDist = Math.abs(cell.x - nearest.x);
    for (const h of headers) {
      const dist = Math.abs(cell.x - h.x);
      if (dist < nearestDist) {
        nearest = h;
        nearestDist = dist;
      }
    }
    record[nearest.text] = record[nearest.text] ? `${record[nearest.text]} ${cell.text}` : cell.text;
  }
  return { record, mismatched: true };
}
