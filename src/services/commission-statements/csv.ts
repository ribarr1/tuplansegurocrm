// Parser CSV mínimo y seguro (RFC 4180: comillas dobles, comas/saltos
// de línea dentro de campos entrecomillados, "" como comilla escapada)
// — deliberadamente NO un simple `line.split(",")`, que rompe con
// cualquier campo entrecomillado (ej. "Cardoso, Leonardo"). Sin
// dependencia nueva: los reportes de comisión son texto plano simple,
// no justifican una librería CSV completa.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normaliza CRLF/CR a LF antes de recorrer — evita duplicar líneas
  // vacías por saltos de línea de Windows.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
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

  // Descarta filas completamente vacías (ej. línea en blanco al final
  // del archivo) — nunca filas con datos parciales.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
