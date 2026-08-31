import fs from "node:fs/promises";
import type { ImportPlan } from "./types";

// Reporte de consola y JSON — Fase 019. NUNCA imprime nombres, emails,
// teléfonos, fechas de nacimiento ni ningún valor de columna sensible.
// Solo cuenta, agrupa por código, y referencia sheet/row.

export function renderConsoleSummary(plan: ImportPlan): string {
  const lines: string[] = [];
  const l = (s: string) => lines.push(s);

  const personsByOutcome = countBy(plan.persons, (p) => p.outcome);
  l(`Archivo: ${plan.sourceFileName}`);
  l("");
  l("Persons:");
  l(`  New: ${personsByOutcome.NEW ?? 0}`);
  l(`  Matched: ${personsByOutcome.MATCHED ?? 0}`);
  l(`  Ambiguous: ${personsByOutcome.AMBIGUOUS ?? 0}`);
  l(`  Conflict: ${personsByOutcome.CONFLICT ?? 0}`);
  l("");
  l("Households:");
  l(`  Planned: ${plan.households.length}`);
  l("");
  const blockedPolicies = plan.policies.filter((p) => p.blocked).length;
  l("Policies:");
  l(`  Planned: ${plan.policies.length - blockedPolicies}`);
  l(`  Blocked: ${blockedPolicies}`);
  l("");
  l("Health details:");
  l(`  Planned: ${plan.policies.filter((p) => !p.blocked && p.policyType === "HEALTH").length}`);
  l("");
  l("Commission expectations:");
  l(`  Planned: ${plan.commissionExpectations.length}`);
  l("");
  l("Commission payments:");
  l(`  Planned: ${plan.commissionPayments.length}`);
  l("");
  l("Sensitive:");
  l(`  Excluded columns: ${plan.sensitiveSummary.excludedColumns.length}`);
  l(`  Rows containing excluded data: ${plan.sensitiveSummary.rowsWithExcludedData}`);
  l(`  Sheets excluded: ${plan.sensitiveSummary.sheetsExcluded.join(", ") || "(none)"}`);
  l("");
  l("Medical (deferred, no detail imported):");
  l(`  Rows with apparent medical data: ${plan.deferredMedical.peopleWithApparentMedicalData}`);
  l("");

  const byCode = countBy(plan.issues, (i) => `${i.severity} ${i.code}`);
  const warnings = plan.issues.filter((i) => i.severity === "WARNING");
  const blocking = plan.issues.filter((i) => i.severity === "BLOCKING");
  l(`Warnings: ${warnings.length}`);
  for (const [code, count] of Object.entries(countBy(warnings, (i) => i.code))) {
    l(`  ${code}: ${count}`);
  }
  l("");
  l(`Errors (BLOCKING): ${blocking.length}`);
  for (const [code, count] of Object.entries(countBy(blocking, (i) => i.code))) {
    l(`  ${code}: ${count}`);
  }
  l("");
  l(`READY_TO_IMPORT: ${plan.readyToImport}`);
  void byCode;
  return lines.join("\n");
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

// El JSON solo incluye datos seguros: severity/code/sheet/row/message.
// message ya fue escrito por el propio pipeline sin PII (ver
// clientes-sheet.ts/commissions-sheet.ts) — nunca se serializa
// plan.persons[].data ni ningún objeto con nombre/email/teléfono/DOB.
export async function writeJsonReport(plan: ImportPlan, outPath: string): Promise<void> {
  const safe = {
    generatedAt: plan.generatedAt,
    sourceFileName: plan.sourceFileName,
    counts: {
      persons: countBy(plan.persons, (p) => p.outcome),
      households: plan.households.length,
      policies: { planned: plan.policies.filter((p) => !p.blocked).length, blocked: plan.policies.filter((p) => p.blocked).length },
      commissionExpectations: plan.commissionExpectations.length,
      commissionPayments: plan.commissionPayments.length,
    },
    sensitiveSummary: plan.sensitiveSummary,
    deferredMedical: plan.deferredMedical,
    issues: plan.issues.map((i) => ({ severity: i.severity, code: i.code, sheet: i.sheet, row: i.row, message: i.message })),
    readyToImport: plan.readyToImport,
  };
  await fs.writeFile(outPath, JSON.stringify(safe, null, 2), "utf-8");
}
