import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025 (Parte L): configura las licencias y contratos REALES del
// agente Ruben Ibarra, exactamente como se especificó en la ficha —
// nunca inventa productos ni carriers no confirmados. Idempotente:
// puede correrse más de una vez sin duplicar filas (se salta lo que
// ya existe). Corre vía prisma directo (no las services guardadas con
// "server-only") por el mismo motivo que apply-plan.ts — es un script
// de Node/tsx fuera del árbol de Next.
//
// Resolución del User real: se hizo explícitamente ANTES de escribir
// este script (ver docs/DECISIONS.md) — exactamente un User llamado
// "ruben ibarra" <ribarr1@gmail.com>, sin ambigüedad. Este script
// vuelve a verificar esa unicidad antes de escribir, por seguridad.
//
// Claudia Natera: deliberadamente NO se incluye en este script — no
// existe todavía como User real y sus contratos no fueron entregados
// en esta fase (ver ficha, "Explicit scope limits").

const RUBEN_LICENSE_STATES = ["IL", "FL", "OH", "TX", "SC", "GA", "NJ"] as const;

const CONTRACTS: {
  carrierName: string;
  policyTypes: ("HEALTH" | "FINAL_EXPENSE" | "SUPPLEMENTAL" | "DENTAL")[];
  states: string[];
  createCarrierIfMissing?: boolean;
}[] = [
  { carrierName: "AMBETTER", policyTypes: ["HEALTH"], states: ["IL", "TX", "FL", "SC", "GA"] },
  { carrierName: "AMERIHEALTH", policyTypes: ["HEALTH"], states: ["FL"], createCarrierIfMissing: true },
  { carrierName: "BLUE CROSS BLUE SHIELD (BCBS)", policyTypes: ["HEALTH"], states: ["TX", "IL"] },
  { carrierName: "CIGNA", policyTypes: ["HEALTH"], states: ["FL", "GA", "TX", "IL"] },
  { carrierName: "SELECTHEALTH", policyTypes: ["HEALTH"], states: ["SC"] },
  { carrierName: "OSCAR", policyTypes: ["HEALTH"], states: ["FL", "IL", "TX", "GA", "NJ", "OH"] },
  {
    carrierName: "Senior Life",
    policyTypes: ["FINAL_EXPENSE"],
    states: [...RUBEN_LICENSE_STATES],
  },
  {
    carrierName: "HEALTHSPRING",
    policyTypes: ["SUPPLEMENTAL", "DENTAL"],
    states: [...RUBEN_LICENSE_STATES],
    createCarrierIfMissing: true,
  },
];

async function main() {
  const matches = await prisma.user.findMany({
    where: { OR: [{ name: { contains: "ruben ibarra", mode: "insensitive" } }, { email: "ribarr1@gmail.com" }] },
    select: { id: true, name: true, email: true },
  });
  if (matches.length !== 1) {
    console.error(`Se esperaba exactamente 1 User para Ruben Ibarra, se encontraron ${matches.length}. Deteniendo.`);
    process.exitCode = 1;
    return;
  }
  const ruben = matches[0];
  console.log(`Usuario resuelto: ${ruben.name} <${ruben.email}> (${ruben.id})`);

  let licensesCreated = 0;
  for (const state of RUBEN_LICENSE_STATES) {
    const existing = await prisma.agentLicense.findUnique({
      where: { userId_state: { userId: ruben.id, state } },
    });
    if (existing) {
      if (existing.status !== "ACTIVE") {
        await prisma.agentLicense.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
        console.log(`Licencia ${state}: reactivada.`);
      } else {
        console.log(`Licencia ${state}: ya existe y está ACTIVE, sin cambios.`);
      }
      continue;
    }
    const created = await prisma.agentLicense.create({
      data: { userId: ruben.id, state, status: "ACTIVE" },
    });
    await prisma.auditEvent.create({
      data: {
        actorUserId: ruben.id,
        actorType: "USER",
        entityType: "AgentLicense",
        entityId: created.id,
        action: "AGENT_LICENSE_CREATE",
        summary: `Licencia de agente creada (${state}) — configuración inicial Fase 025`,
      },
    });
    licensesCreated++;
    console.log(`Licencia ${state}: creada.`);
  }

  let contractsCreated = 0;
  let carriersCreated = 0;
  for (const spec of CONTRACTS) {
    let carrier = await prisma.carrier.findFirst({
      where: { name: { equals: spec.carrierName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!carrier) {
      if (!spec.createCarrierIfMissing) {
        console.error(`Carrier "${spec.carrierName}" no encontrado en el catálogo y no está marcado para crear. Deteniendo.`);
        process.exitCode = 1;
        return;
      }
      carrier = await prisma.carrier.create({ data: { name: spec.carrierName, isActive: true } });
      carriersCreated++;
      console.log(`Carrier "${spec.carrierName}": creado (no existía en el catálogo).`);
    } else {
      console.log(`Carrier "${spec.carrierName}": resuelto contra catálogo existente como "${carrier.name}".`);
    }

    for (const policyType of spec.policyTypes) {
      for (const state of spec.states) {
        const existing = await prisma.agentCarrierContract.findUnique({
          where: {
            userId_carrierId_state_policyType: {
              userId: ruben.id,
              carrierId: carrier.id,
              state,
              policyType,
            },
          },
        });
        if (existing) {
          console.log(`Contrato ${spec.carrierName}/${policyType}/${state}: ya existe, sin cambios.`);
          continue;
        }
        const created = await prisma.agentCarrierContract.create({
          data: { userId: ruben.id, carrierId: carrier.id, state, policyType, status: "ACTIVE" },
        });
        await prisma.auditEvent.create({
          data: {
            actorUserId: ruben.id,
            actorType: "USER",
            entityType: "AgentCarrierContract",
            entityId: created.id,
            action: "AGENT_CONTRACT_CREATE",
            summary: `Contrato creado: ${spec.carrierName} / ${policyType} / ${state} — configuración inicial Fase 025`,
          },
        });
        contractsCreated++;
      }
    }
  }

  console.log("---");
  console.log(`Licencias creadas: ${licensesCreated} (de ${RUBEN_LICENSE_STATES.length} esperadas)`);
  console.log(`Carriers creados: ${carriersCreated}`);
  console.log(`Contratos creados: ${contractsCreated}`);
}

main()
  .catch((e) => {
    console.error("Error configurando licencias/contratos de Ruben:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
