import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createCommissionRule } from "../src/services/commission-rules.service";
import type { AuthorizedUser } from "../src/lib/authorization";

// ---------------------------------------------------------------------------
// PRODUCCIÓN — creación de las 18 CommissionRule (confianza ALTA/MEDIA)
// ya verificadas en DEV, reproducidas aquí por CLAVE DE NEGOCIO estable
// (carrier.name + product.name), NUNCA por productId/ruleId de DEV —
// esos UUID pueden (y probablemente van a) ser distintos en PROD.
//
// Reutiliza EXCLUSIVAMENTE createCommissionRule() de
// src/services/commission-rules.service.ts — nunca inserta filas de
// CommissionRule directamente. Esa función ya hace, por su cuenta:
//   - Verificar que el producto existe.
//   - Desactivar cualquier regla ACTIVE previa de ese scope (nunca 2
//     reglas ACTIVE simultáneas para el mismo producto).
//   - Crear la regla + su AuditEvent, dentro de su propia transacción
//     interna (ver commission-rules.service.ts:96-141).
//
// Este script NUNCA crea ni modifica CommissionExpectation,
// CommissionPayment, CommissionStatement ni CommissionStatementRow —
// las 266 CommissionExpectation existentes conservan
// generatedByRuleId = null a propósito (instrucción explícita: son
// históricas, nunca se reasocian retroactivamente).
//
// EJECUCIÓN: createCommissionRule (vía commission-rules.service.ts)
// importa transitivamente módulos con `import "server-only"` — mismo
// caso que scripts/link-commission-payments-prod.ts. Se usa el mismo
// shim ya existente, nunca se toca el guard real:
//
//   node --require ./scripts/server-only-shim.cjs --import tsx scripts/create-commission-rules-prod.ts [--apply|--verify]
// ---------------------------------------------------------------------------

// Las 18 reglas ya verificadas en DEV — datos de NEGOCIO (carrier real +
// nombre real de producto, tal como están en el catálogo), nunca un ID
// de fila. Method/base/periodicidad son los mismos para las 18 (tarifa
// fija mensual por miembro cubierto, sin residual — no hay evidencia de
// un escalón de tarifa distinto a partir de cierto año de póliza).
const TARGET_RULES: readonly {
  carrier: string;
  product: string;
  rate: string;
  confidence: "ALTA" | "MEDIA";
}[] = [
  { carrier: "AMBETTER", product: "STANDARD SILVER", rate: "25.00", confidence: "ALTA" },
  { carrier: "AMBETTER", product: "MYBLUE PLUS BRONZE 912", rate: "25.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "BRONZE ELITE + PCP SAVER PLUS RX (CHOICE)", rate: "25.00", confidence: "ALTA" },
  { carrier: "AMBETTER", product: "SILVER SIMPLE BREATHE EASY WITH ENHANCED COPD BENEFITS CSR 150 HMO $0 $0", rate: "30.00", confidence: "ALTA" },
  { carrier: "OSCAR", product: "SILVER SIMPLE PCP SAVER CSR 250", rate: "20.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "MYBLUE PLUS BRONZE 912", rate: "20.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "BLUE REEDY SILVER 2", rate: "45.00", confidence: "MEDIA" },
  { carrier: "OSCAR", product: "Silver Classic Saver Plus CSR 200", rate: "20.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "BLUE REEDY STANDARD EXPANDED BRONZE", rate: "21.00", confidence: "MEDIA" },
  { carrier: "OSCAR", product: "BRONZE CLASSIC STARDARD", rate: "18.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "MYBLUE PLUS GOLD 909", rate: "20.00", confidence: "ALTA" },
  { carrier: "OSCAR", product: "GOLD SIMPLE (CHOICE)", rate: "25.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "MYBLUE PLUS BRONZE STANDARD - SELECT RX COPAYS", rate: "20.00", confidence: "ALTA" },
  { carrier: "OSCAR", product: "GOLD SIMPLE CHOICE HMO", rate: "25.00", confidence: "ALTA" },
  { carrier: "BLUE CROSS BLUE SHIELD (BCBS)", product: "BLUE PRECISION BRONZE HMO 701", rate: "30.00", confidence: "MEDIA" },
  { carrier: "OSCAR", product: "BLUE PRECISION BRONZE HMO 701", rate: "25.00", confidence: "ALTA" },
  { carrier: "OSCAR", product: "GOLD SIMPLE", rate: "25.00", confidence: "ALTA" },
  { carrier: "OSCAR", product: "BLUE PRECISION GOLD HMO 703", rate: "25.00", confidence: "MEDIA" },
];

const METHOD = "FIXED_AMOUNT" as const;
const BASE = "PER_MEMBER" as const;
const PERIODICITY = "MONTHLY" as const;

type PlanRow = {
  target: (typeof TARGET_RULES)[number];
  status: "MISSING" | "MATCHES" | "CONFLICT_PRODUCT_NOT_FOUND" | "CONFLICT_PRODUCT_AMBIGUOUS" | "CONFLICT_DIFFERENT_CONFIG";
  detail: string;
  productId?: string;
};

type Mode = "dry-run" | "apply" | "verify";

function parseArgs(): { mode: Mode } {
  const args = process.argv.slice(2);
  if (args.includes("--apply")) return { mode: "apply" };
  if (args.includes("--verify")) return { mode: "verify" };
  return { mode: "dry-run" };
}

function describeDatabaseTarget(): string {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(raw);
    return `host=${url.hostname} puerto=${url.port || "(default)"} base=${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "(no se pudo interpretar DATABASE_URL)";
  }
}

async function resolveAdminActor(): Promise<AuthorizedUser> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: { equals: "ribarr1@gmail.com", mode: "insensitive" }, role: "ADMIN", isActive: true },
    select: { id: true, email: true, name: true, role: true, isActive: true, twoFactorEnabled: true },
  });
  return admin as AuthorizedUser;
}

// Resuelve el producto por CLAVE DE NEGOCIO (carrier.name exacto +
// product.name exacto) — nunca por ID. Reporta ambigüedad en vez de
// adivinar si hubiera más de una coincidencia.
async function resolveProduct(carrier: string, product: string) {
  const matches = await prisma.product.findMany({
    where: { name: product, carrier: { name: carrier } },
    select: { id: true, isActive: true },
  });
  return matches;
}

async function computePlan(): Promise<PlanRow[]> {
  const plan: PlanRow[] = [];
  for (const target of TARGET_RULES) {
    const matches = await resolveProduct(target.carrier, target.product);
    if (matches.length === 0) {
      plan.push({ target, status: "CONFLICT_PRODUCT_NOT_FOUND", detail: `No existe un producto "${target.product}" bajo el carrier "${target.carrier}".` });
      continue;
    }
    if (matches.length > 1) {
      plan.push({ target, status: "CONFLICT_PRODUCT_AMBIGUOUS", detail: `${matches.length} productos coinciden con "${target.carrier}" / "${target.product}" — no se puede determinar cuál usar.` });
      continue;
    }
    const productId = matches[0].id;
    const existingActive = await prisma.commissionRule.findFirst({
      where: { productId, policyId: null, isActive: true },
      select: { id: true, method: true, base: true, initialAmount: true, initialPeriodicity: true, residualEnabled: true },
    });
    if (!existingActive) {
      plan.push({ target, status: "MISSING", detail: "No hay ninguna regla ACTIVA para este producto todavía.", productId });
      continue;
    }
    const sameConfig =
      existingActive.method === METHOD &&
      existingActive.base === BASE &&
      existingActive.initialPeriodicity === PERIODICITY &&
      existingActive.residualEnabled === false &&
      existingActive.initialAmount !== null &&
      Number(existingActive.initialAmount).toFixed(2) === Number(target.rate).toFixed(2);
    if (sameConfig) {
      plan.push({ target, status: "MATCHES", detail: `Ya existe una regla ACTIVA idéntica (id=${existingActive.id}).`, productId });
    } else {
      plan.push({
        target,
        status: "CONFLICT_DIFFERENT_CONFIG",
        detail: `Ya existe una regla ACTIVA (id=${existingActive.id}) pero con otra configuración (rate=${existingActive.initialAmount}, method=${existingActive.method}, base=${existingActive.base}, periodicidad=${existingActive.initialPeriodicity}, residual=${existingActive.residualEnabled}) distinta de la esperada (rate=${target.rate}, ${METHOD}, ${BASE}, ${PERIODICITY}, sin residual).`,
        productId,
      });
    }
  }
  return plan;
}

function printPlan(plan: PlanRow[]) {
  const counts = { MISSING: 0, MATCHES: 0, CONFLICT_PRODUCT_NOT_FOUND: 0, CONFLICT_PRODUCT_AMBIGUOUS: 0, CONFLICT_DIFFERENT_CONFIG: 0 };
  for (const row of plan) counts[row.status]++;

  console.log(`  Reglas objetivo (esperadas):     ${TARGET_RULES.length}`);
  console.log(`  Ya existen y coinciden:           ${counts.MATCHES}`);
  console.log(`  Faltan (se crearían):             ${counts.MISSING}`);
  console.log(`  Conflicto — producto no existe:   ${counts.CONFLICT_PRODUCT_NOT_FOUND}`);
  console.log(`  Conflicto — producto ambiguo:     ${counts.CONFLICT_PRODUCT_AMBIGUOUS}`);
  console.log(`  Conflicto — config. distinta:     ${counts.CONFLICT_DIFFERENT_CONFIG}`);

  console.log("\n  Detalle:");
  for (const row of plan) {
    console.log(`    [${row.status}] ${row.target.carrier} | ${row.target.product} | rate=$${row.target.rate} — ${row.detail}`);
  }

  const totalConflicts = counts.CONFLICT_PRODUCT_NOT_FOUND + counts.CONFLICT_PRODUCT_AMBIGUOUS + counts.CONFLICT_DIFFERENT_CONFIG;
  return { counts, totalConflicts };
}

async function dryRun() {
  console.log(`Base de datos objetivo: ${describeDatabaseTarget()}`);
  console.log("\n=== DRY RUN — no se modifica absolutamente nada ===\n");
  const plan = await computePlan();
  const { totalConflicts, counts } = printPlan(plan);

  console.log("\n--- Resultado ---");
  if (totalConflicts > 0) {
    console.log(`  HAY ${totalConflicts} CONFLICTO(S) — --apply se detendrá automáticamente hasta que se resuelvan.`);
  } else if (counts.MISSING === 0) {
    console.log("  Las 18 reglas ya existen y coinciden — nada que aplicar (idempotente).");
  } else {
    console.log(`  Listo para --apply: se crearían ${counts.MISSING} regla(s) nueva(s), 0 conflictos.`);
  }
}

async function apply() {
  console.log(`Base de datos objetivo: ${describeDatabaseTarget()}`);
  console.log("\n=== Verificación previa (antes de escribir nada) ===\n");
  const plan = await computePlan();
  const { totalConflicts, counts } = printPlan(plan);

  if (totalConflicts > 0) {
    console.error(`\nABORTADO: ${totalConflicts} conflicto(s) detectado(s). No se creó ninguna regla. Resuelve los conflictos listados arriba antes de reintentar.`);
    process.exitCode = 1;
    return;
  }

  if (counts.MISSING === 0) {
    console.log("\nLas 18 reglas ya existen y coinciden — nada que aplicar (operación idempotente, 0 cambios).");
    await verify();
    return;
  }

  console.log(`\nSin conflictos — creando ${counts.MISSING} regla(s) faltante(s) vía createCommissionRule()...\n`);
  const actor = await resolveAdminActor();

  // createCommissionRule() ya envuelve su propia escritura en una
  // transacción interna (ver commission-rules.service.ts) — no acepta
  // un cliente `tx` externo, así que no es posible envolver las 18
  // llamadas en UNA sola transacción de base de datos sin tocar ese
  // servicio (cosa que este ticket prohíbe). Cada creación individual
  // SÍ es atómica por sí sola (todo-o-nada para esa regla); si una
  // llamada falla a mitad de la corrida, las reglas ya creadas antes
  // quedan válidas y completas, y la operación es re-ejecutable sin
  // riesgo (idempotente: --apply nunca duplica lo que ya coincide).
  let createdCount = 0;
  for (const row of plan) {
    if (row.status !== "MISSING") continue;
    try {
      const created = await createCommissionRule(actor, {
        productId: row.productId!,
        method: METHOD,
        base: BASE,
        initialAmount: row.target.rate,
        initialPeriodicity: PERIODICITY,
        residualEnabled: "false",
      });
      console.log(`  Creada: ${row.target.carrier} | ${row.target.product} -> ruleId=${created.id}`);
      createdCount++;
    } catch (e) {
      console.error(`\nERROR creando la regla de "${row.target.carrier} | ${row.target.product}": ${e instanceof Error ? e.message : String(e)}`);
      console.error(`Deteniendo — ${createdCount} regla(s) ya quedaron creadas correctamente antes de este error (operación re-ejecutable).`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n${createdCount} regla(s) creada(s).\n`);
  await verify();
}

async function verify() {
  console.log("=== Verificación final ===\n");
  const plan = await computePlan();
  const matches = plan.filter((r) => r.status === "MATCHES").length;
  const conflicts = plan.filter((r) => r.status.startsWith("CONFLICT")).length;
  const missing = plan.filter((r) => r.status === "MISSING").length;

  console.log(`  Reglas esperadas:        ${TARGET_RULES.length}`);
  console.log(`  Coinciden y activas:     ${matches}`);
  console.log(`  Faltantes:               ${missing}`);
  console.log(`  Conflictos:              ${conflicts}`);

  // Duplicados inesperados: más de 1 CommissionRule ACTIVE para el
  // mismo producto (el índice único parcial de la migración 016 ya lo
  // impide a nivel de base, esto es una segunda confirmación explícita).
  const activeByProduct = await prisma.commissionRule.groupBy({
    by: ["productId"],
    where: { isActive: true, policyId: null },
    _count: true,
  });
  const duplicated = activeByProduct.filter((g) => g._count > 1);
  console.log(`  Productos con >1 regla ACTIVA (duplicados, debería ser 0): ${duplicated.length}`);

  const ok = matches === TARGET_RULES.length && conflicts === 0 && missing === 0 && duplicated.length === 0;
  console.log(`\n  Resultado: ${ok ? "COINCIDE con DEV — las 18 reglas están correctamente creadas." : "NO COINCIDE — revisar manualmente."}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const { mode } = parseArgs();
  if (mode === "dry-run") await dryRun();
  else if (mode === "apply") await apply();
  else await verify();
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
