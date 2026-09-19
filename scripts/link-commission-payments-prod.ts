import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { linkPendingPaymentsToExpectation } from "../src/services/commission-payment-linking";
import type { AuthorizedUser } from "../src/lib/authorization";

// ---------------------------------------------------------------------------
// PRODUCCIÓN — vinculación retroactiva de CommissionPayment huérfanos
// (commissionExpectationId = null) a su CommissionExpectation existente
// (mismo policyId + period), reproduciendo en PROD la corrección ya
// verificada en DEV.
//
// Reutiliza EXCLUSIVAMENTE la función oficial ya existente en el
// proyecto — linkPendingPaymentsToExpectation() en
// src/services/commission-payment-linking.ts — la MISMA que usa
// generateExpectationForPeriod() en el flujo normal de la aplicación
// (ver src/services/commission-rules.service.ts:363-368). Este script
// NUNCA escribe directamente sobre commission_payments ni
// commission_statement_rows: solo llama a esa función, una vez por cada
// CommissionExpectation existente, dentro de una única transacción.
//
// NUNCA crea CommissionPayment, CommissionExpectation, CommissionStatement
// ni CommissionStatementRow. NUNCA modifica montos, períodos, fechas,
// asistencia, pólizas ni ningún dato histórico — linkPendingPaymentsToExpectation
// solo actualiza dos columnas (commissionExpectationId, matchedExpectationId)
// y registra el AuditEvent correspondiente.
//
// Idempotente: si no quedan pagos con commissionExpectationId = null,
// termina sin cambiar nada (0 vinculados), sin importar cuántas veces
// se ejecute.
//
// EJECUCIÓN: este script importa (transitivamente, vía
// linkPendingPaymentsToExpectation) módulos marcados con
// `import "server-only"` — un guard real que solo debe protegerlos de
// una importación accidental desde un Client Component de Next.js,
// nunca de una ejecución operacional legítima como esta. `tsx` por sí
// solo no lo tolera fuera del bundler de Next.js, así que este script
// SIEMPRE debe invocarse con el shim dedicado (ver
// scripts/server-only-shim.cjs — no toca ni desactiva el guard real, y
// nunca se aplica dentro de `next dev`/`build`/`start`):
//
//   node --require ./scripts/server-only-shim.cjs --import tsx scripts/link-commission-payments-prod.ts [--apply|--verify]
//
// Ejecutarlo con solo `npx tsx scripts/link-commission-payments-prod.ts`
// falla con "This module cannot be imported from a Client Component
// module" — ese es exactamente el guard de server-only funcionando
// como se espera fuera de Next.js, no un bug de este script.
// ---------------------------------------------------------------------------

// Resultado observado y ya verificado en DEV con esta misma base de
// datos de comisiones — se usa SOLO como verificación de seguridad
// (comparación), nunca para forzar el resultado. Si el estado real de
// PROD (antes de aplicar) no coincide con esto, el script se detiene
// sin tocar nada — un número distinto significaría que PROD tiene datos
// diferentes a los que se validaron en DEV, y aplicar a ciegas sería
// arriesgado.
const EXPECTED_LINKABLE = 86;
const EXPECTED_TOTAL_PAYMENTS = 112;

type Mode = "dry-run" | "apply" | "verify";

function parseArgs(): { mode: Mode } {
  const args = process.argv.slice(2);
  if (args.includes("--apply")) return { mode: "apply" };
  if (args.includes("--verify")) return { mode: "verify" };
  return { mode: "dry-run" };
}

// Nunca imprime DATABASE_URL completo — solo host/puerto/nombre de base,
// igual que el patrón ya establecido en scripts/clean-dev-database.ts.
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
  // Resuelto por correo, nunca un ID fijo en el script — mismo criterio
  // que el resto de scripts operativos de este proyecto.
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: { equals: "ribarr1@gmail.com", mode: "insensitive" }, role: "ADMIN", isActive: true },
    select: { id: true, email: true, name: true, role: true, isActive: true, twoFactorEnabled: true },
  });
  return admin as AuthorizedUser;
}

// Calcula, SIN escribir nada, cuántos pagos huérfanos (commissionExpectationId
// = null) tienen una CommissionExpectation esperando con el mismo
// (policyId, period) — exactamente el mismo criterio de emparejamiento
// que usa linkPendingPaymentsToExpectation() internamente.
async function computeLinkagePlan() {
  const totalPayments = await prisma.commissionPayment.count();
  const alreadyLinked = await prisma.commissionPayment.count({ where: { commissionExpectationId: { not: null } } });
  const orphaned = await prisma.commissionPayment.findMany({
    where: { commissionExpectationId: null },
    select: { id: true, policyId: true, period: true },
  });

  const expectationsInvolved = new Set<string>();
  let wouldLink = 0;
  for (const p of orphaned) {
    const exp = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: p.policyId, period: p.period } },
      select: { id: true },
    });
    if (exp) {
      wouldLink++;
      expectationsInvolved.add(exp.id);
    }
  }

  return {
    totalPayments,
    alreadyLinked,
    orphanedCount: orphaned.length,
    wouldLink,
    wouldRemainUnlinked: orphaned.length - wouldLink,
    expectationsInvolved: expectationsInvolved.size,
  };
}

async function printPlan(plan: Awaited<ReturnType<typeof computeLinkagePlan>>) {
  console.log(`  Pagos totales:               ${plan.totalPayments}`);
  console.log(`  Ya vinculados:                ${plan.alreadyLinked}`);
  console.log(`  Pendientes (sin vincular):    ${plan.orphanedCount}`);
  console.log(`  Se vincularían ahora:         ${plan.wouldLink}`);
  console.log(`  Quedarían sin vincular:       ${plan.wouldRemainUnlinked}`);
  console.log(`  Expectativas involucradas:    ${plan.expectationsInvolved}`);
}

// El estado "ya aplicado" (idempotente) NO es simplemente
// "orphanedCount === 0": los 26 pagos sin regla/expectativa confiable
// se quedan huérfanos PARA SIEMPRE (nunca tendrán una
// CommissionExpectation esperando), así que orphanedCount sigue en 26
// incluso después de una corrección exitosa. La señal real de "ya se
// aplicó" es que ya no queda NADA vinculable (wouldLink === 0) Y el
// total ya vinculado alcanzó el esperado — nunca se confunde esto con
// "no hay nada pendiente en la tabla".
function alreadyApplied(plan: Awaited<ReturnType<typeof computeLinkagePlan>>): boolean {
  return plan.wouldLink === 0 && plan.alreadyLinked >= EXPECTED_LINKABLE;
}

async function dryRun() {
  console.log(`Base de datos objetivo: ${describeDatabaseTarget()}`);
  console.log("\n=== DRY RUN — no se modifica absolutamente nada ===\n");
  const plan = await computeLinkagePlan();
  await printPlan(plan);

  console.log("\n--- Comparación contra el resultado ya verificado en DEV ---");
  if (alreadyApplied(plan)) {
    console.log(`  Ya no queda nada vinculable (vinculados=${plan.alreadyLinked}) — la corrección ya fue aplicada. Nada que hacer.`);
  } else if (plan.totalPayments === EXPECTED_TOTAL_PAYMENTS && plan.wouldLink === EXPECTED_LINKABLE) {
    console.log(`  OK: se vincularían ${plan.wouldLink} pagos, igual que en DEV (${EXPECTED_LINKABLE}). Listo para --apply.`);
  } else {
    console.log(
      `  ADVERTENCIA: totalPayments=${plan.totalPayments} (esperado ${EXPECTED_TOTAL_PAYMENTS}), se vincularían ${plan.wouldLink} (esperado ${EXPECTED_LINKABLE}). ` +
        `El estado de PROD difiere del que se validó en DEV — --apply se detendrá automáticamente hasta que esto se entienda.`
    );
  }
}

async function apply() {
  console.log(`Base de datos objetivo: ${describeDatabaseTarget()}`);
  console.log("\n=== Verificación previa (antes de escribir nada) ===\n");
  const plan = await computeLinkagePlan();
  await printPlan(plan);

  if (alreadyApplied(plan)) {
    console.log("\nYa no queda nada vinculable — nada que aplicar (operación idempotente, 0 cambios).");
    await verify();
    return;
  }

  // Dos validaciones EXPLÍCITAS e independientes, ambas obligatorias
  // antes de escribir nada: el universo total de pagos debe coincidir
  // con DEV (112) Y el número de vinculables debe coincidir (86). Un
  // total distinto de 112 por sí solo ya es motivo de abortar, aunque
  // por casualidad wouldLink diera 86 — nunca se asume que un total
  // distinto es inofensivo solo porque el otro número coincidió.
  if (plan.totalPayments !== EXPECTED_TOTAL_PAYMENTS) {
    console.error(
      `\nABORTADO: se esperaban exactamente ${EXPECTED_TOTAL_PAYMENTS} CommissionPayment totales (igual que en DEV) pero PROD tiene ${plan.totalPayments}. ` +
        `No se modificó nada. El universo de pagos de PROD difiere del validado en DEV — revisa manualmente antes de reintentar.`
    );
    process.exitCode = 1;
    return;
  }

  if (plan.wouldLink !== EXPECTED_LINKABLE) {
    console.error(
      `\nABORTADO: se esperaba vincular exactamente ${EXPECTED_LINKABLE} pagos (igual que en DEV) pero el cálculo real da ${plan.wouldLink}. ` +
        `No se modificó nada. Revisa manualmente por qué el estado de PROD difiere del validado en DEV antes de reintentar.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nCoincide con DEV (${EXPECTED_LINKABLE} vinculables) — aplicando dentro de una transacción...\n`);

  const actor = await resolveAdminActor();
  const expectations = await prisma.commissionExpectation.findMany({
    select: { id: true, policyId: true, period: true },
  });

  let totalLinked = 0;
  await prisma.$transaction(async (tx) => {
    for (const exp of expectations) {
      const linked = await linkPendingPaymentsToExpectation(tx, {
        expectationId: exp.id,
        policyId: exp.policyId,
        period: exp.period,
        actor,
      });
      totalLinked += linked;
    }
    if (totalLinked !== EXPECTED_LINKABLE) {
      // Aborta la transacción completa — ver requisito 13, nunca se
      // deja una corrección parcial.
      throw new Error(
        `La transacción vinculó ${totalLinked} pagos, se esperaban ${EXPECTED_LINKABLE}. Revirtiendo todo.`
      );
    }
  });

  console.log(`Transacción aplicada: ${totalLinked} pagos vinculados.\n`);
  await verify();
}

async function verify() {
  console.log("=== Verificación final ===\n");
  const totalPayments = await prisma.commissionPayment.count();
  const linked = await prisma.commissionPayment.count({ where: { commissionExpectationId: { not: null } } });
  const unlinked = totalPayments - linked;

  console.log(`  Pagos totales:      ${totalPayments} (esperado: ${EXPECTED_TOTAL_PAYMENTS})`);
  console.log(`  Vinculados:         ${linked} (esperado: ${EXPECTED_LINKABLE})`);
  console.log(`  Sin vincular:       ${unlinked} (esperado: ${EXPECTED_TOTAL_PAYMENTS - EXPECTED_LINKABLE})`);

  const ok =
    totalPayments === EXPECTED_TOTAL_PAYMENTS &&
    linked === EXPECTED_LINKABLE &&
    unlinked === EXPECTED_TOTAL_PAYMENTS - EXPECTED_LINKABLE;

  console.log(`\n  Resultado: ${ok ? "COINCIDE con DEV — corrección aplicada correctamente." : "NO COINCIDE — revisar manualmente antes de continuar."}`);
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
    // Nunca imprime el objeto de error crudo si pudiera contener datos
    // sensibles (no debería, pero por precaución se limita al mensaje).
    console.error("ERROR:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
