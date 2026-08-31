import type ExcelJS from "exceljs";
import { getSheet, stringCell, decimalCell } from "./workbook";
import { foldForMatching } from "./normalize";
import { CARRIER_NAME_MAP } from "./mappings";
import type { ImportIssue, CommissionExpectationPlanEntry, CommissionPaymentPlanEntry, PolicyPlanEntry } from "./types";

// Parser de "Comisiones" (pagos reales recibidos) y "estimacion
// Comisiones" (montos esperados) — Fase 019. Ambas hojas comparten
// estructura: TITULAR NOMBRE Y APELLIDO / ESTADO / COMPAÑIA DE SEGUROS
// / MIEMBROS / ENE..DIC. El titular solo aparece en la primera fila de
// cada bloque (patrón legacy típico de Excel con celdas "combinadas
// visualmente" pero no realmente combinadas) — se arrastra hacia abajo
// hasta la siguiente fila con un nombre no vacío.
//
// Cada columna de mes -> un CommissionExpectation/CommissionPayment
// distinto (period = primer día de ese mes del año en curso del
// workbook — ver docs/IMPORTING_LEGACY_DATA.md sobre el supuesto de
// año). Nunca se crean columnas Jan/Feb en la base de datos: cada celda
// con monto se convierte en su propio registro.
//
// Vincular una fila con una Policy real requiere (titular resuelto +
// compañía) -> exactamente una Policy planeada de esa combinación. Si
// hay cero o más de una, se reporta y NO se importa esa fila (nunca se
// adivina a cuál póliza pertenece un monto).

const MONTHS: { header: string; month: number }[] = [
  { header: "ENE", month: 1 },
  { header: "FEB", month: 2 },
  { header: "MAR", month: 3 },
  { header: "ABR", month: 4 },
  { header: "MAY", month: 5 },
  { header: "JUN", month: 6 },
  { header: "JUL", month: 7 },
  { header: "AGO", month: 8 },
  { header: "SEP", month: 9 },
  { header: "OCT", month: 10 },
  { header: "NOV", month: 11 },
  { header: "DIC", month: 12 },
];

export type PolicyIndexEntry = { foldedName: string; carrierName: string; policy: PolicyPlanEntry };

export function buildPolicyIndex(
  policies: PolicyPlanEntry[],
  personKeyToFoldedName: Map<string, string>
): PolicyIndexEntry[] {
  return policies
    .filter((p) => !p.blocked)
    .map((p) => {
      const foldedName = personKeyToFoldedName.get(p.holderPersonKey) ?? "";
      return { foldedName, carrierName: p.carrierName, policy: p };
    });
}

function findPolicyForRow(
  index: PolicyIndexEntry[],
  foldedName: string,
  carrierName: string
): { policy: PolicyPlanEntry } | { ambiguous: true } | { notFound: true } {
  const matches = index.filter((e) => e.foldedName === foldedName && e.carrierName === carrierName);
  if (matches.length === 1) return { policy: matches[0].policy };
  if (matches.length > 1) return { ambiguous: true };
  return { notFound: true };
}

export function parseCommissionsLikeSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  kind: "PAYMENT" | "EXPECTATION",
  policyIndex: PolicyIndexEntry[],
  year: number
): {
  expectations: CommissionExpectationPlanEntry[];
  payments: CommissionPaymentPlanEntry[];
  issues: ImportIssue[];
} {
  const sheet = getSheet(workbook, sheetName);
  const issues: ImportIssue[] = [];
  const expectations: CommissionExpectationPlanEntry[] = [];
  const payments: CommissionPaymentPlanEntry[] = [];

  if (!sheet) {
    issues.push({
      severity: "WARNING",
      code: "SHEET_NOT_FOUND",
      sheet: sheetName,
      message: `La hoja "${sheetName}" no existe en este workbook.`,
    });
    return { expectations, payments, issues };
  }

  let currentHolderName: string | null = null;

  const rows: { row: ExcelJS.Row; rowNumber: number }[] = [];
  sheet.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    let hasData = false;
    row.eachCell({ includeEmpty: false }, () => {
      hasData = true;
    });
    if (hasData) rows.push({ row, rowNumber });
  });

  for (const { row, rowNumber } of rows) {
    const nameCell = stringCell(sheet, row, "TITULAR NOMBRE Y APELLIDO");
    if (nameCell) currentHolderName = nameCell;
    if (!currentHolderName) {
      issues.push({
        severity: "WARNING",
        code: "COMMISSION_ROW_WITHOUT_HOLDER",
        sheet: sheetName,
        row: rowNumber,
        message: "Fila de comisión sin titular identificable (ni en esta fila ni arrastrado de una anterior) — se omite.",
      });
      continue;
    }

    const carrierRaw = stringCell(sheet, row, "COMPAÑIA DE SEGUROS");
    const carrierName = carrierRaw ? CARRIER_NAME_MAP[carrierRaw.trim().toUpperCase()] : undefined;
    if (!carrierRaw) continue; // fila de continuación sin datos de comisión propios (ej. separador)
    if (!carrierName) {
      issues.push({
        severity: "WARNING",
        code: "UNKNOWN_CARRIER",
        sheet: sheetName,
        row: rowNumber,
        message: `Compañía de seguros no reconocida ("${carrierRaw}") en fila de comisión — se omite.`,
      });
      continue;
    }

    const folded = foldForMatching(currentHolderName);
    const found = findPolicyForRow(policyIndex, folded, carrierName);
    if ("ambiguous" in found) {
      issues.push({
        severity: "BLOCKING",
        code: "COMMISSION_POLICY_AMBIGUOUS",
        sheet: sheetName,
        row: rowNumber,
        message: "Más de una póliza coincide con titular+compañía para esta fila de comisión — no se puede vincular sin ambigüedad.",
      });
      continue;
    }
    if ("notFound" in found) {
      issues.push({
        severity: "BLOCKING",
        code: "COMMISSION_POLICY_NOT_FOUND",
        sheet: sheetName,
        row: rowNumber,
        message: "No se encontró una póliza planeada que coincida con titular+compañía para esta fila de comisión.",
      });
      continue;
    }

    for (const { header, month } of MONTHS) {
      const amount = decimalCell(sheet, row, header);
      if (amount === null) continue;
      const period = new Date(Date.UTC(year, month - 1, 1));
      if (kind === "EXPECTATION") {
        expectations.push({
          sheet: sheetName,
          row: rowNumber,
          holderNameRaw: currentHolderName,
          carrierName,
          period,
          expectedAmount: amount,
          matchedPolicy: found.policy,
        });
      } else {
        payments.push({
          sheet: sheetName,
          row: rowNumber,
          holderNameRaw: currentHolderName,
          carrierName,
          period,
          amount,
          matchedPolicy: found.policy,
        });
      }
    }
  }

  return { expectations, payments, issues };
}
