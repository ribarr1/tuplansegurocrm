// Clasificación de columnas/hojas prohibidas — Fase 019.
//
// REGLA ABSOLUTA: ninguna función de este pipeline debe leer el VALOR
// de una columna listada aquí más allá de contarla. Nunca debe
// aparecer en un ImportIssue.message, en el reporte JSON, ni en
// consola. Ver docs/IMPORTING_LEGACY_DATA.md y docs/SECURITY.md.

// Nombres de columna exactos (según el workbook real de TuPlanSeguro
// USA, hoja "clientes"/"clientescumpleaños") que nunca se leen.
export const EXCLUDED_SENSITIVE_COLUMNS = [
  // SSN (titular, cónyuge, dependientes 1-6)
  "TITULAR NUMERO DE SEGURIDAD SOCIAL",
  "CONYUGUE NUMERO DE SEGURIDAD SOCIALCONYUGUE NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 1 NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 2 NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 3 NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 4 NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 5 NUMERO DE SEGURIDAD SOCIAL",
  "DEPENDIENTE 6 NUMERO DE SEGURIDAD SOCIAL",
  // Documento de inmigración — no es SSN pero es un identificador
  // documental sensible sin campo de destino en el schema; se excluye
  // por el mismo principio de minimización de datos, no solo por regla
  // explícita de las 6 categorías bancarias/credenciales.
  "TITULAR USCIS#",
  "CONYUGUE USCIS#",
  "DEPENDIENTE 1 USCIS#",
  "DEPENDIENTE 2 USCIS#",
  "DEPENDIENTE 3 USCIS#",
  "DEPENDIENTE 4 USCIS#",
  "DEPENDIENTE 5 USCIS#",
  "DEPENDIENTE 6 USCIS#",
  // Datos bancarios
  "BANCO",
  "TITULAR DE LA CUENTA BANCARIA",
  "NUMERO DE RUTA",
  "NUMERO DE CUENTA",
  "CIUDAD DEL BANCO",
  "ESTADO DEL BANCO",
  // Datos de tarjeta
  "NOMBRE IMPRESO EN LA TARJETA",
  "TIPO DE TARJETA",
  "COMPAÑIA DE LA TARJETA",
  "NUMERO DE LA TARJETA",
  "MES DE VENCIMIENTO DE LA TARJETA",
  "AÑO DE VENCIMIENTO DE LA TARJETA",
  "CODIGO DE SEGURIDAD DE LA TARJETA",
] as const;

// Hojas completas que nunca se leen más allá de su nombre/tamaño —
// credenciales de portales de aseguradoras.
export const EXCLUDED_SENSITIVE_SHEETS = ["cuentas aseguradoras"] as const;

export function isExcludedColumn(header: string): boolean {
  return (EXCLUDED_SENSITIVE_COLUMNS as readonly string[]).includes(header.trim());
}

export function isExcludedSheet(sheetName: string): boolean {
  const normalized = sheetName.trim().toLowerCase();
  return EXCLUDED_SENSITIVE_SHEETS.some((s) => s.toLowerCase() === normalized);
}
