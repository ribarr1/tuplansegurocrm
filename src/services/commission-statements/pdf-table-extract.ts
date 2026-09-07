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
//
// Fase 025.5.2: la cantidad de filas de un reporte NUNCA es fija — un
// reporte real puede traer 1, 4, 25 o cientos de registros, en una o
// varias páginas. Lo único estable es la estructura de columnas de cada
// adapter. Este módulo nunca asume un número de filas ni de páginas;
// solo aplica límites de SEGURIDAD (tamaño/páginas/filas), nunca de
// negocio.
// ---------------------------------------------------------------------------

export const MAX_PDF_PAGES = 20;
// Tope de seguridad (memoria/tiempo), nunca un límite de negocio — un
// reporte real con más filas que esto se rechaza con un mensaje claro
// en vez de agotar recursos, nunca se trunca en silencio.
export const MAX_PDF_ROWS = 2000;
const ROW_Y_GAP_THRESHOLD = 4; // pt — separación mínima real entre filas distintas en estos reportes (~12pt)

export interface PdfTextRow {
  page: number;
  y: number;
  cells: { text: string; x: number }[];
}

export interface ExtractedPdfTable {
  pageCount: number;
  rows: PdfTextRow[];
}

// Errores "esperados" — el ADMIN puede actuar sobre ellos (el PDF en sí
// tiene un problema real: dañado, cifrado, formato no compatible,
// demasiadas páginas/filas). Mensaje seguro para mostrar tal cual.
export class PdfTooManyPagesError extends Error {}
export class PdfTooManyRowsError extends Error {}
export class PdfParseError extends Error {}
// Fase 025.5.4 — falla de INFRAESTRUCTURA (worker de pdfjs, módulo
// faltante, configuración server-side), nunca un problema real del
// archivo del usuario. Nunca se le dice al ADMIN "tu PDF está dañado"
// cuando en realidad falló el procesador — eso llevó exactamente al
// bug reportado ("Setting up fake worker failed" mostrado como PDF
// inválido). El detalle técnico real se registra aparte, solo en
// servidor (ver reconciliation.service.ts), nunca en el mensaje que
// llega al ADMIN.
export class PdfInternalError extends Error {}
// Estructura reconocida como PDF válido, pero sus columnas no
// coinciden con ningún adapter — señal real y esperada (formato no
// compatible), nunca un fallo interno.
export class PdfFormatMismatchError extends Error {}

export async function extractPdfRows(buffer: Buffer): Promise<ExtractedPdfTable> {
  // Import diferido: pdfjs-dist es relativamente pesado, nunca se carga
  // fuera del flujo real de importación de comisiones.
  const { getDocument, InvalidPDFException, PasswordException } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    // Solo InvalidPDFException/PasswordException son señales REALES de
    // que el archivo en sí es el problema (dañado/cifrado/no es un PDF
    // real) — pdfjs las expone como clases propias precisamente para
    // esto. Cualquier otro fallo (worker, módulo, timeout, error
    // interno desconocido) es un problema del PROCESADOR, nunca del
    // archivo, y se propaga como PdfInternalError — nunca se declara el
    // PDF dañado sin evidencia real de que lo esté.
    if (error instanceof InvalidPDFException || error instanceof PasswordException) {
      throw new PdfParseError(
        `No se pudo leer el archivo PDF (está dañado, cifrado, o no es un PDF real): ${error.message}`
      );
    }
    throw new PdfInternalError(
      `Fallo interno del procesador de PDF: ${error instanceof Error ? error.message : "error desconocido"}`
    );
  }

  if (doc.numPages > MAX_PDF_PAGES) {
    throw new PdfTooManyPagesError(
      `El PDF tiene ${doc.numPages} páginas — el máximo permitido es ${MAX_PDF_PAGES}.`
    );
  }

  // Fase 025.5.2: NUNCA se ordenan los items de TODAS las páginas juntos
  // por Y — la coordenada Y se reinicia en cada página nueva (el tope de
  // la página 2 tiene una Y alta, igual que el tope de la página 1), así
  // que un sort global por Y intercalaría filas de páginas distintas.
  // Cada página se agrupa/ordena de forma INDEPENDIENTE y las páginas se
  // concatenan en orden — eso preserva el orden real del documento sin
  // depender de coordenadas absolutas compartidas entre páginas.
  const rows: PdfTextRow[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageItems: { text: string; x: number; y: number }[] = [];
    for (const raw of content.items) {
      // TextItem siempre trae `str`; TextMarkedContent (raro, sin texto
      // real) no — se descarta con un narrowing explícito, nunca `any`.
      if (!("str" in raw)) continue;
      const text = raw.str.trim();
      if (!text) continue;
      pageItems.push({ text, x: raw.transform[4], y: raw.transform[5] });
    }

    // Clustering por Y con tolerancia — nunca redondeo simple (ver
    // comentario de arriba, causaba una fila real partida en dos).
    pageItems.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of pageItems) {
      const lastRow = rows[rows.length - 1];
      if (lastRow && lastRow.page === pageNumber && lastRow.y - item.y <= ROW_Y_GAP_THRESHOLD) {
        lastRow.cells.push({ text: item.text, x: item.x });
        lastRow.cells.sort((a, b) => a.x - b.x);
      } else {
        rows.push({ page: pageNumber, y: item.y, cells: [{ text: item.text, x: item.x }] });
      }
    }
  }

  if (rows.length > MAX_PDF_ROWS) {
    throw new PdfTooManyRowsError(
      `El PDF tiene ${rows.length} filas estructurales — el máximo permitido es ${MAX_PDF_ROWS}.`
    );
  }

  return { pageCount: doc.numPages, rows };
}

function normalizeHeaderText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Verdadero cuando TODAS las celdas de `row` coinciden (como conjunto,
// sin importar el orden) con los encabezados requeridos — usado para
// reconocer un encabezado REPETIDO en una página posterior, que nunca
// debe tratarse como fila de datos (ver Corrección 4, Fase 025.5.2).
function isHeaderRepeat(row: PdfTextRow, requiredNormalized: string[]): boolean {
  const rowTexts = new Set(row.cells.map((c) => normalizeHeaderText(c.text)));
  return requiredNormalized.every((h) => rowTexts.has(h));
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
//
// Fase 025.5.2: un reporte de varias páginas repite el encabezado en
// cada página nueva — esas repeticiones se EXCLUYEN de `dataRows`
// (nunca se parsean como si fueran un registro real) y se reportan
// aparte en `headerRepeatCount`, nunca en silencio total (queda
// trazable en el resultado).
export function tableFromRows(
  rows: PdfTextRow[],
  requiredHeaders: readonly string[]
): { headerRowIndex: number; headers: string[]; dataRows: PdfTextRow[]; headerRepeatCount: number } | null {
  const requiredNormalized = requiredHeaders.map(normalizeHeaderText);

  const headerRowIndex = rows.findIndex((row) => isHeaderRepeat(row, requiredNormalized));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].cells.map((c) => c.text);
  const rest = rows.slice(headerRowIndex + 1);

  let headerRepeatCount = 0;
  const dataRows = rest.filter((row) => {
    if (isHeaderRepeat(row, requiredNormalized)) {
      headerRepeatCount++;
      return false;
    }
    return true;
  });

  return { headerRowIndex, headers, dataRows, headerRepeatCount };
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
