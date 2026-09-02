// Constructor CSV mínimo (RFC 4180) — UTF-8 estándar, sin BOM. Nunca se
// usa para importar (eso es `src/import/`), solo para exportar
// listados ya autorizados y ya minimizados por cada servicio (ver
// export.service.ts) — este helper no sabe nada de autorización ni de
// qué campos son sensibles, solo serializa lo que se le pasa.
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvField(cell === null || cell === undefined ? "" : String(cell))).join(","));
  }
  return lines.join("\r\n");
}
