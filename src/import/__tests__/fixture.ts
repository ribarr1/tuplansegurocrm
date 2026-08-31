import ExcelJS from "exceljs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Fixture ficticio generado en memoria — Fase 019. NUNCA se versiona
// como .xlsx (ver docs/IMPORTING_LEGACY_DATA.md); se escribe a un
// archivo temporal fuera del repo justo antes de cada test y se borra
// después. Ningún nombre/email/teléfono aquí es una persona real.

const CLIENTES_HEADERS = [
  "INDEX",
  "ESTATUS",
  "TITULAR NOMBRE Y APELLIDO",
  "AGENTE",
  "FECHA DE INICIO",
  "ESTADO",
  "COMPAÑIA DE SEGUROS",
  "ASISTENCIA",
  "PLAN",
  "PRIMA",
  "DEDUCIBLE",
  "MAXIMO DE BOLSILLO",
  "INGRESOS",
  "CREDITO FISCAL",
  "TITULAR EMAIL",
  "TITULAR FECHA DE NACIMIENTO",
  "TITULAR NUMERO DE SEGURIDAD SOCIAL",
  "TITULAR NOMBRE",
  "TITULAR APELLIDO",
  "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?",
  "TITULAR TELEFONO",
  "CONYUGUE EMAIL",
  "CONYUGUE FECHA DE NACIMIENTO",
  "CONYUGUE NOMBRE",
  "CONYUGUE APELLIDO",
  "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?",
  "CONYUGUE TELEFONO",
  "DEPENDIENTE 1 NOMBRE Y APELLIDO",
  "DEPENDIENTE 1 FECHA DE NACIMIENTO",
  "DEPENDIENTE 1 RELACION",
  "¿EL DEPENDIENTE 1 ESTARA CUBIERTO EN ESTA POLIZA?",
  "BANCO",
  "NUMERO DE CUENTA",
  "TIPO DE APLICACION",
];

const COMMISSION_HEADERS = ["TITULAR NOMBRE Y APELLIDO", "ESTADO", "COMPAÑIA DE SEGUROS", "MIEMBROS", "ENE", "FEB"];

export type ClienteRow = Partial<Record<(typeof CLIENTES_HEADERS)[number], string | number | Date>>;

export function buildFixtureWorkbook(options: {
  clientesRows: ClienteRow[];
  comisionesRows?: Record<string, string | number>[];
  estimacionRows?: Record<string, string | number>[];
  includeCredentialsSheet?: boolean;
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  const clientesSheet = workbook.addWorksheet("clientes");
  clientesSheet.addRow(CLIENTES_HEADERS);
  for (const row of options.clientesRows) {
    clientesSheet.addRow(CLIENTES_HEADERS.map((h) => row[h] ?? ""));
  }

  const comisionesSheet = workbook.addWorksheet("Comisiones");
  comisionesSheet.addRow(COMMISSION_HEADERS);
  for (const row of options.comisionesRows ?? []) {
    comisionesSheet.addRow(COMMISSION_HEADERS.map((h) => row[h] ?? ""));
  }

  const estimacionSheet = workbook.addWorksheet("estimacion Comisiones ");
  estimacionSheet.addRow(COMMISSION_HEADERS);
  for (const row of options.estimacionRows ?? []) {
    estimacionSheet.addRow(COMMISSION_HEADERS.map((h) => row[h] ?? ""));
  }

  workbook.addWorksheet("fichamedica").addRow(["TITULAR NOMBRE Y APELLIDO", "MEDICAMENTOS"]);

  if (options.includeCredentialsSheet !== false) {
    const credSheet = workbook.addWorksheet("cuentas aseguradoras");
    credSheet.addRow(["ca", "user", "clave"]);
    credSheet.addRow(["Ambetter", "fixture-user", "fixture-pass"]);
  }

  return workbook;
}

export async function writeTempWorkbook(workbook: ExcelJS.Workbook): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "import-fixture-"));
  const filePath = path.join(dir, "fixture.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

export async function cleanupTempWorkbook(filePath: string): Promise<void> {
  await fs.rm(path.dirname(filePath), { recursive: true, force: true });
}
