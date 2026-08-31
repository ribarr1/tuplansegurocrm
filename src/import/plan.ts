import path from "node:path";
import { loadWorkbook, getSheet, rowCount, countRowsWithExcludedData, isExcludedSheet } from "./workbook";
import { EXCLUDED_SENSITIVE_COLUMNS, EXCLUDED_SENSITIVE_SHEETS } from "./sensitive";
import { PersonRegistry } from "./matching";
import { foldForMatching } from "./normalize";
import { parseClientesSheet } from "./clientes-sheet";
import { buildPolicyIndex, parseCommissionsLikeSheet } from "./commissions-sheet";
import type { ImportIssue, ImportPlan } from "./types";

// Orquestador del plan de importación — Fase 019. Lee el workbook UNA
// vez, construye persons/households/policies desde "clientes", vincula
// comisiones desde "Comisiones"/"estimacion Comisiones", cuenta
// exclusiones sensibles y datos médicos diferidos, y decide
// READY_TO_IMPORT. No escribe nada en PostgreSQL — eso es apply.ts.

const SHEET_NAMES = {
  clientes: "clientes",
  clientesCumpleanos: "clientescumpleaños",
  comisiones: "Comisiones",
  estimacionComisiones: "estimacion Comisiones ",
  fichamedica: "fichamedica",
  cumpleanos: "Cumpleaños",
  cuentasAseguradoras: "cuentas aseguradoras",
} as const;

export async function buildImportPlan(filePath: string, options?: { commissionYear?: number }): Promise<ImportPlan> {
  const workbook = await loadWorkbook(filePath);
  const issues: ImportIssue[] = [];
  const sensitiveSheetsFound: string[] = [];
  let rowsWithExcludedData = 0;

  for (const worksheet of workbook.worksheets) {
    if (isExcludedSheet(worksheet.name)) {
      sensitiveSheetsFound.push(worksheet.name);
      issues.push({
        severity: "EXCLUDED_SENSITIVE",
        code: "SHEET_EXCLUDED_CREDENTIALS",
        sheet: worksheet.name,
        message: `Hoja excluida por contener credenciales de aseguradoras (${worksheet.rowCount > 0 ? "no se lee su contenido" : "vacía"}).`,
      });
      continue;
    }
    const handle = getSheet(workbook, worksheet.name);
    if (handle) rowsWithExcludedData += countRowsWithExcludedData(handle);
  }

  const registry = new PersonRegistry();

  const clientesResult = await parseClientesSheet(workbook, SHEET_NAMES.clientes, registry);
  issues.push(...clientesResult.issues);

  // clientescumpleaños se usa SOLO como validación cruzada de DOB, nunca
  // como segunda fuente de creación de Person/Household/Policy — no se
  // llama a parseClientesSheet sobre ella. Se reporta su tamaño y se
  // deja para una fase de validación cruzada explícita futura si el
  // negocio lo pide (ver docs/DECISIONS.md).
  const cumpleañosHandle = getSheet(workbook, SHEET_NAMES.clientesCumpleanos);
  if (cumpleañosHandle) {
    issues.push({
      severity: "INFO",
      code: "AUX_BIRTHDAY_SHEET_NOT_IMPORTED",
      sheet: SHEET_NAMES.clientesCumpleanos,
      message: `"${SHEET_NAMES.clientesCumpleanos}" tiene ${rowCount(cumpleañosHandle)} filas — se usa solo como fuente auxiliar potencial de fecha de nacimiento, nunca como fuente independiente de personas/pólizas en esta fase.`,
    });
  }

  const cumpleanosSimpleHandle = getSheet(workbook, SHEET_NAMES.cumpleanos);
  if (cumpleanosSimpleHandle) {
    issues.push({
      severity: "INFO",
      code: "BIRTHDAY_GREETING_NOT_IMPORTED",
      sheet: SHEET_NAMES.cumpleanos,
      message: `"${SHEET_NAMES.cumpleanos}" tiene ${rowCount(cumpleanosSimpleHandle)} filas — no hay evidencia estructurada suficiente (estado/canal/año de envío) para importar BirthdayGreeting histórico; no se importa.`,
    });
  }

  const fichamedicaHandle = getSheet(workbook, SHEET_NAMES.fichamedica);
  const deferredMedicalCount = fichamedicaHandle ? rowCount(fichamedicaHandle) : 0;
  if (fichamedicaHandle) {
    issues.push({
      severity: "INFO",
      code: "MEDICAL_DATA_DEFERRED",
      sheet: SHEET_NAMES.fichamedica,
      message: `"${SHEET_NAMES.fichamedica}" tiene ${deferredMedicalCount} filas con datos aparentemente médicos — DEFERRED_SENSITIVE, no se importa en esta fase (ver docs/DECISIONS.md).`,
    });
  }

  const personKeyToFoldedName = new Map<string, string>();
  for (const p of clientesResult.persons) {
    personKeyToFoldedName.set(p.key, foldForMatching(`${p.data.firstName} ${p.data.lastName}`));
  }
  const policyIndex = buildPolicyIndex(clientesResult.policies, personKeyToFoldedName);

  const commissionYear = options?.commissionYear ?? new Date().getFullYear();

  const expectationsResult = parseCommissionsLikeSheet(
    workbook,
    SHEET_NAMES.estimacionComisiones,
    "EXPECTATION",
    policyIndex,
    commissionYear
  );
  issues.push(...expectationsResult.issues);

  const paymentsResult = parseCommissionsLikeSheet(
    workbook,
    SHEET_NAMES.comisiones,
    "PAYMENT",
    policyIndex,
    commissionYear
  );
  issues.push(...paymentsResult.issues);

  const hasBlocking = issues.some((i) => i.severity === "BLOCKING");

  return {
    generatedAt: new Date(),
    sourceFileName: path.basename(filePath),
    persons: clientesResult.persons,
    households: clientesResult.households,
    policies: clientesResult.policies,
    commissionExpectations: expectationsResult.expectations,
    commissionPayments: paymentsResult.payments,
    issues,
    sensitiveSummary: {
      excludedColumns: [...EXCLUDED_SENSITIVE_COLUMNS],
      rowsWithExcludedData,
      sheetsExcluded: sensitiveSheetsFound.length ? sensitiveSheetsFound : [...EXCLUDED_SENSITIVE_SHEETS],
    },
    deferredMedical: { peopleWithApparentMedicalData: deferredMedicalCount },
    readyToImport: !hasBlocking,
  };
}
