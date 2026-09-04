import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getAppTimeZone, getTodayBusinessRange } from "../src/lib/business-time-core";
import { reconcilePolicyLifecycleCore } from "../src/services/policy-lifecycle-core";

// Entrypoint CLI independiente de la reconciliación automática del
// ciclo de vida de pólizas — Fase 025 (Hallazgo #5 de UAT, Parte E).
// `npm run jobs:policy-lifecycle`.
//
// Corre fuera del árbol de Next (vía tsx), así que importa
// policy-lifecycle-core.ts directamente (sin el guard "server-only") —
// ver el comentario de cabecera de ese archivo.
//
// Salida SIEMPRE segura para logs (nunca nombres de clientes ni otro
// PII): solo el día de negocio calculado y los conteos de filas
// afectadas. Ver docs/OPERATIONS.md para cómo correrlo manualmente y
// un ejemplo conceptual de cron futuro.
async function main() {
  // Falla temprano y con un mensaje claro si APP_TIME_ZONE falta o es
  // inválido — nunca corre la reconciliación con una zona horaria
  // adivinada (ver business-time.ts).
  const timeZone = getAppTimeZone();
  const businessDate = getTodayBusinessRange();

  console.log(`[policy-lifecycle] Zona horaria de negocio: ${timeZone}`);
  console.log(
    `[policy-lifecycle] Día de negocio: ${businessDate.year}-${String(businessDate.month).padStart(2, "0")}-${String(businessDate.day).padStart(2, "0")}`
  );

  const result = await reconcilePolicyLifecycleCore(businessDate);

  console.log(`[policy-lifecycle] Pólizas activadas (PENDING -> ACTIVE): ${result.activatedCount}`);
  console.log(`[policy-lifecycle] Pólizas expiradas (ACTIVE -> EXPIRED): ${result.expiredCount}`);
  console.log("[policy-lifecycle] Reconciliación completada.");
}

main()
  .catch((e) => {
    console.error("[policy-lifecycle] Error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
