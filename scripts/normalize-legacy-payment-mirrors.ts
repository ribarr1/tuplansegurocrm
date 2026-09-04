import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025.1 (Hallazgo #3 de UAT): paymentManagementMode es la fuente
// de verdad autoritativa — reconstruye los booleanos legacy
// (autopay/needsPaymentAssistance) a partir de ella para TODAS las
// pólizas, nunca al revés. Corrige específicamente las 2 filas que
// arrastraban autopay=true Y needsPaymentAssistance=true desde ANTES
// de Fase 025 (la migración 016 backfilleó paymentManagementMode
// desde esos booleanos pero nunca corrigió los booleanos mismos hacia
// la nueva fuente de verdad).
//
// Idempotente: recalcula sin condición (siempre el mismo resultado
// para el mismo paymentManagementMode), así que correrlo de nuevo
// nunca cambia nada ya correcto.

function deriveLegacyMirrors(mode: "AUTOPAY" | "ASSISTED" | "CLIENT_MANAGED") {
  return {
    autopay: mode === "AUTOPAY",
    needsPaymentAssistance: mode === "ASSISTED",
  };
}

async function main() {
  const before = await prisma.policy.count({ where: { autopay: true, needsPaymentAssistance: true } });
  console.log(`Filas inválidas (autopay=true Y needsPaymentAssistance=true) ANTES: ${before}`);

  for (const mode of ["AUTOPAY", "ASSISTED", "CLIENT_MANAGED"] as const) {
    const mirrors = deriveLegacyMirrors(mode);
    const result = await prisma.policy.updateMany({
      where: {
        paymentManagementMode: mode,
        NOT: { autopay: mirrors.autopay, needsPaymentAssistance: mirrors.needsPaymentAssistance },
      },
      data: mirrors,
    });
    console.log(`${mode}: ${result.count} filas corregidas.`);
  }

  const after = await prisma.policy.count({ where: { autopay: true, needsPaymentAssistance: true } });
  console.log(`Filas inválidas DESPUÉS: ${after}`);
}

main()
  .catch((e) => {
    console.error("Error normalizando mirrors legacy de pago:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
