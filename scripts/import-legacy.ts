import "dotenv/config";
import path from "node:path";
import { buildImportPlan } from "../src/import/plan";
import { applyImportPlan } from "../src/import/apply";
import { renderConsoleSummary, writeJsonReport } from "../src/import/report";

// CLI de importación de datos legacy — Fase 019.
//
//   npm run import:legacy -- --file "C:\ruta\al\archivo.xlsx"
//
// Por defecto: DRY RUN (no escribe nada en PostgreSQL). Para escribir
// se requieren AMBOS flags explícitos: --apply --confirm. El workbook
// real y el reporte JSON generado nunca deben commitearse — ver
// .gitignore y docs/IMPORTING_LEGACY_DATA.md.

function parseArgs(argv: string[]) {
  const fileIndex = argv.indexOf("--file");
  const file = fileIndex !== -1 ? argv[fileIndex + 1] : undefined;
  const apply = argv.includes("--apply");
  const confirm = argv.includes("--confirm");
  const yearIndex = argv.indexOf("--commission-year");
  const commissionYear = yearIndex !== -1 ? Number(argv[yearIndex + 1]) : undefined;
  return { file, apply, confirm, commissionYear };
}

async function main() {
  const { file, apply, confirm, commissionYear } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('Uso: npm run import:legacy -- --file "C:\\ruta\\al\\archivo.xlsx" [--apply --confirm]');
    process.exit(1);
  }

  const plan = await buildImportPlan(file, { commissionYear });
  console.log(renderConsoleSummary(plan));

  const reportPath = path.join(process.cwd(), "private-imports", "import-report.json");
  await writeJsonReport(plan, reportPath);
  console.log(`\nReporte machine-readable escrito en: ${reportPath}`);

  if (!apply) {
    console.log("\nDRY RUN — no se escribió nada en PostgreSQL. Usa --apply --confirm para aplicar.");
    return;
  }

  if (!confirm) {
    console.error(
      "\n--apply requiere también --confirm (evita ejecutar la escritura definitiva por accidente)."
    );
    process.exit(1);
  }

  if (!plan.readyToImport) {
    console.error("\nEl plan tiene errores BLOCKING — no se puede aplicar. Corrige y vuelve a correr el dry run.");
    process.exit(1);
  }

  console.log("\nAplicando cambios en PostgreSQL (transacción única)...");
  const result = await applyImportPlan(plan);
  console.log(JSON.stringify(result, null, 2));
  console.log("\nAPPLY completo.");
}

main()
  .catch((err) => {
    console.error("ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
