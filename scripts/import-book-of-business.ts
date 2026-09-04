import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parseCsv, csvRowsToRecords } from "../src/import/book-of-business/csv";
import { parseSourceRecords } from "../src/import/book-of-business/parse-source";
import { buildImportPlan } from "../src/import/book-of-business/build-plan";
import { applyImportPlan } from "../src/import/book-of-business/apply-plan";
import { resetBusinessDataForImport } from "../src/import/book-of-business/wipe";
import { buildImportReport } from "../src/import/book-of-business/report";
import { prisma } from "../src/lib/prisma";

// CLI del importador del libro de negocio real — Fase 023, Parte B.
//
//   npx tsx scripts/import-book-of-business.ts --dry-run
//   npx tsx scripts/import-book-of-business.ts --apply --confirm-dev-wipe
//
// --dry-run: solo parsea/valida/construye el plan en memoria — CERO
// escrituras en DB. --apply requiere ADEMÁS --confirm-dev-wipe (nunca
// se ejecuta un wipe por accidente) y solo procede si el dry-run no
// tiene errores BLOCKING. Ver requiredImportOrder en
// tuplanseguro_client_import_mapping.json — este script sigue ese
// orden literalmente: parse -> validate -> normalize -> plan -> confirm
// -> wipe -> apply -> report.

const CSV_PATH = process.env.BOOK_IMPORT_CSV ?? path.join("private-imports", "exported-table.csv");
const CARRIERS_PATH =
  process.env.BOOK_IMPORT_CARRIERS ?? path.join("private-imports", "tuplanseguro_carriers_normalized.json");
const REPORT_PATH = path.join("private-imports", "book-import-report.json");

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    apply: args.includes("--apply"),
    confirmDevWipe: args.includes("--confirm-dev-wipe"),
  };
}

// Muestra host/port/database/user del DATABASE_URL — NUNCA la
// contraseña. Aborta si no puede confirmarse que es un ambiente local.
function verifyLocalDatabaseTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  const match = /^postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^:/?]+)(?::(\d+))?\/([^?]+)/.exec(url);
  if (!match) {
    console.error("No se pudo interpretar DATABASE_URL. DETENIÉNDOSE.");
    process.exit(1);
  }
  const [, user, , host, port, database] = match;
  console.log("Target de base de datos (verificación de seguridad):");
  console.log(`  host: ${host}`);
  console.log(`  port: ${port ?? "(default)"}`);
  console.log(`  database: ${database}`);
  console.log(`  user: ${user}`);

  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (!isLocalHost) {
    console.error(
      "\nDATABASE_URL no apunta claramente a localhost/127.0.0.1. Esta operación puede DESTRUIR datos de negocio. DETENIÉNDOSE — no se ejecuta ninguna escritura."
    );
    process.exit(1);
  }
  console.log("  -> confirmado: ambiente local/dev.\n");
}

async function main() {
  const { dryRun, apply, confirmDevWipe } = parseArgs();
  if (!dryRun && !apply) {
    console.error("Debes indicar --dry-run o --apply --confirm-dev-wipe.");
    process.exit(1);
  }
  if (apply && !confirmDevWipe) {
    console.error("--apply requiere también --confirm-dev-wipe (evita ejecuciones accidentales).");
    process.exit(1);
  }

  verifyLocalDatabaseTarget();

  // --- 1) parse files ---
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`No se encontró el CSV en ${CSV_PATH}.`);
    process.exit(1);
  }
  if (!fs.existsSync(CARRIERS_PATH)) {
    console.error(`No se encontró el catálogo de carriers en ${CARRIERS_PATH}.`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const carrierCatalog = JSON.parse(fs.readFileSync(CARRIERS_PATH, "utf8")) as {
    records: { name: string; isActive: boolean }[];
  };

  const rows = parseCsv(csvText);
  const records = csvRowsToRecords(rows);
  const { rows: sourceRows, issues: parseIssues } = parseSourceRecords(records);

  // --- 2) validate + 3) normalize + 4) build plan ---
  const plan = await buildImportPlan(sourceRows, parseIssues, carrierCatalog.records);

  // --- 5) confirmar que no hay errores BLOCKING estructurales ---
  const report = buildImportReport(plan, null);
  console.log(JSON.stringify(report, null, 2));

  if (!plan.readyToImport) {
    console.error(
      `\nEl plan tiene ${report.blockingErrors.length} error(es) BLOCKING — no se puede aplicar. Revisa blockingErrors arriba.`
    );
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(dryRun ? 0 : 1);
  }

  if (dryRun) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\nDry-run completo. Reporte (sin PII) escrito en ${REPORT_PATH}. Ninguna escritura en DB.`);
    return;
  }

  // --- 6) wipe (solo con --apply --confirm-dev-wipe y target ya verificado) ---
  console.log("\nEjecutando reset de datos de negocio (preserva User/Account/Session/Verification)...");
  await resetBusinessDataForImport();
  console.log("Reset completo.");

  // --- 7) apply ---
  // El plan de arriba se construyó ANTES del wipe — su dedup de
  // personas (buildImportPlan) consultó la DB tal como estaba entonces
  // y puede haber marcado personas como MATCHED_EXISTING contra filas
  // que el wipe recién borró. Aplicar ESE plan directamente violaría
  // FKs (personId apuntando a una Person que ya no existe). Se
  // reconstruye el plan una segunda vez, ahora contra la DB ya vacía
  // de negocio — determinista, mismo input, mismo resultado salvo que
  // ahora toda persona sale NEW en vez de MATCHED_EXISTING (§42,
  // idempotencia). Esto también revalida "0 errores BLOCKING" contra
  // el estado real que se va a escribir, no uno obsoleto.
  console.log("Reconstruyendo el plan contra la base ya reseteada (evita FKs a personas ya borradas)...");
  const postWipePlan = await buildImportPlan(sourceRows, parseIssues, carrierCatalog.records);
  if (!postWipePlan.readyToImport) {
    console.error("El plan post-wipe tiene errores BLOCKING inesperados — deteniéndose sin aplicar.");
    console.error(JSON.stringify(buildImportReport(postWipePlan, null).blockingErrors, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log("Aplicando el plan de import...");
  const carrierNames = carrierCatalog.records.map((c) => c.name);
  const applyResult = await applyImportPlan(postWipePlan, carrierNames);

  const finalReport = buildImportReport(postWipePlan, applyResult);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(finalReport, null, 2));
  console.log(JSON.stringify(finalReport, null, 2));
  console.log(`\nImport aplicado. Reporte (sin PII) escrito en ${REPORT_PATH}.`);
}

main()
  .catch((error) => {
    console.error("Error en el import:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
