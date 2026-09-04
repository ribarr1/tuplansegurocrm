import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025 (Parte I/K): clasifica retroactivamente Propia/Referida
// para las pólizas que ya existían ANTES de que esta lógica existiera
// (quedaron en UNKNOWN por default de la migración). Usa exactamente
// la misma regla que policy-business-source.service.ts (Household.
// state + AgentLicense ACTIVE + AgentCarrierContract ACTIVE) — nunca
// una regla distinta solo para este script. Solo toca pólizas
// businessSource=UNKNOWN, nunca reclasifica una ya calculada
// (idempotente: correrlo de nuevo no cambia nada ya clasificado).
//
// Reporta SOLO conteos — nunca nombres de clientes (ver CLAUDE.md §32,
// nunca PII innecesaria en salida/logs).

async function main() {
  const candidates = await prisma.policy.findMany({
    where: { businessSource: "UNKNOWN" },
    select: {
      id: true,
      householdId: true,
      household: { select: { state: true } },
      product: { select: { carrierId: true, policyType: true } },
    },
  });

  console.log(`Pólizas candidatas (businessSource=UNKNOWN): ${candidates.length}`);

  let classifiedOwn = 0;
  let classifiedReferral = 0;
  let stillUnknownNoHousehold = 0;
  let stillUnknownNoState = 0;

  for (const policy of candidates) {
    if (!policy.householdId) {
      stillUnknownNoHousehold++;
      continue;
    }
    const state = policy.household?.state;
    if (!state) {
      stillUnknownNoState++;
      continue;
    }

    const [licenses, contracts] = await Promise.all([
      prisma.agentLicense.findMany({ where: { state, status: "ACTIVE" }, select: { userId: true } }),
      prisma.agentCarrierContract.findMany({
        where: {
          state,
          carrierId: policy.product.carrierId,
          policyType: policy.product.policyType,
          status: "ACTIVE",
        },
        select: { userId: true },
      }),
    ]);
    const licensedUserIds = new Set(licenses.map((l) => l.userId));
    const eligible = contracts.some((c) => licensedUserIds.has(c.userId));

    const businessSource = eligible ? "OWN" : "REFERRAL";
    await prisma.policy.update({ where: { id: policy.id }, data: { businessSource } });
    if (eligible) classifiedOwn++;
    else classifiedReferral++;
  }

  console.log("---");
  console.log(`Clasificadas OWN: ${classifiedOwn}`);
  console.log(`Clasificadas REFERRAL: ${classifiedReferral}`);
  console.log(`Sin household (quedan UNKNOWN): ${stillUnknownNoHousehold}`);
  console.log(`Household sin state (quedan UNKNOWN): ${stillUnknownNoState}`);
}

main()
  .catch((e) => {
    console.error("Error clasificando pólizas existentes:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
