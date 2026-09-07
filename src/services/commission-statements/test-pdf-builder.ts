// ---------------------------------------------------------------------------
// Fase 025.5.2 — construcción de PDF sintéticos mínimos para pruebas de
// los adaptadores PDF (Orange/Oscar, Orange/Kaiser, Elite/BCBS). NUNCA
// se usa fuera de tests — genera texto posicionado vía Tm/Tj con la
// fuente estándar Helvetica (sin dependencias externas), reproduciendo
// únicamente la ESTRUCTURA de columnas confirmada, jamás contenido real.
//
// Soporta una o varias páginas para poder probar que el extractor
// (pdf-table-extract.ts) nunca asume un número fijo de filas ni de
// páginas — ver pdf-table-extract.test.ts y pdf-import.service.test.ts.
// ---------------------------------------------------------------------------

const COL_WIDTH = 90;
const START_X = 40;
const START_Y = 750;
const LINE_HEIGHT = 16;

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPageContent(table: string[][]): string {
  let content = "BT\n/F1 9 Tf\n";
  table.forEach((row, rowIndex) => {
    const y = START_Y - rowIndex * LINE_HEIGHT;
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const x = START_X + colIndex * COL_WIDTH;
      content += `1 0 0 1 ${x} ${y} Tm\n(${escapePdfText(cell)}) Tj\n`;
    });
  });
  content += "ET";
  return content;
}

// Un solo objeto PDF por página + su stream de contenido; todas las
// páginas comparten el mismo objeto de fuente. `pages` es un array de
// tablas (cada tabla = filas de esa página, típicamente encabezado +
// datos de esa página) — el caller decide si repite el encabezado en
// cada página o no, igual que un reporte real de varias páginas.
export function buildTestTablePdf(pages: string[][] | string[][][]): Buffer {
  const normalizedPages: string[][][] = Array.isArray(pages[0]?.[0])
    ? (pages as string[][][])
    : [pages as string[][]];

  const maxCols = Math.max(1, ...normalizedPages.flat().map((r) => r.length));
  const pageWidth = START_X * 2 + maxCols * COL_WIDTH;

  // Objetos fijos: 1=Catalog, 2=Pages, 3=Font. Luego, por cada página:
  // un objeto /Page y un objeto /Contents.
  const objects: string[] = [];
  const pageObjNumbers: number[] = [];
  const FONT_OBJ = 3;
  let nextObjNum = 4;

  const pageAndContentObjs: string[] = [];
  for (const pageTable of normalizedPages) {
    const content = buildPageContent(pageTable);
    const pageObjNum = nextObjNum++;
    const contentObjNum = nextObjNum++;
    pageObjNumbers.push(pageObjNum);
    pageAndContentObjs.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${FONT_OBJ} 0 R >> >> /MediaBox [0 0 ${pageWidth} 792] /Contents ${contentObjNum} 0 R >>`
    );
    pageAndContentObjs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  }

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjNumbers.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(...pageAndContentObjs);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

export function makePdfFile(buffer: Buffer, name: string): File {
  return new File([new Uint8Array(buffer)], name, { type: "application/pdf" });
}
