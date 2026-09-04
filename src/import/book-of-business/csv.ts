// Parser CSV mínimo RFC4180 — el export real (private-imports/*.csv)
// cita TODOS los campos ("valor","valor",...), incluyendo OBSERVACIONES
// en texto libre que puede contener comas, comillas escapadas ("")
// y saltos de línea dentro de un campo citado. No se usa una librería
// externa (papaparse/csv-parse) porque el formato de entrada es
// conocido y acotado — ver CLAUDE.md ("no agregar librerías
// innecesariamente").

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normaliza CRLF -> LF de antemano para no tener que distinguirlos
  // dentro del loop; un \r suelto (Mac clásico) no se espera en este
  // export y no se maneja especialmente.
  const src = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  // Última fila sin salto de línea final.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// Convierte filas crudas [][] en objetos { header: value } usando la
// primera fila como encabezado. Lanza si una fila tiene un número de
// columnas distinto del encabezado — preferible detenerse temprano a
// desalinear columnas silenciosamente.
export function csvRowsToRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows.map((row, idx) => {
    if (row.length !== header.length) {
      throw new Error(
        `Fila ${idx + 2} del CSV tiene ${row.length} columnas, se esperaban ${header.length} (encabezado desalineado).`
      );
    }
    const record: Record<string, string> = {};
    header.forEach((col, i) => {
      record[col] = row[i] ?? "";
    });
    return record;
  });
}
