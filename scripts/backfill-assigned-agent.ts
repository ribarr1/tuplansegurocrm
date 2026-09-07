import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { classifyUnassignedContacts, applyBackfill } from "./lib/assigned-agent-backfill";

// ---------------------------------------------------------------------------
// Fase 025.5.1 (UAT-11) — backfill seguro de Person.assignedAgentId.
//
// Root cause de UAT-11 (ver docs/DECISIONS.md): assertActiveAgent exigía
// role==="AGENT", así que CUALQUIER intento de asignar un contacto a un
// ADMIN+isAgent=true (ej. el dueño de la agencia) fallaba en silencio —
// ya corregido en people.service.ts. Este script NO es la corrección
// del bug (eso vive en el código de la app); es la limpieza posterior:
// muchos contactos reales quedaron con assignedAgentId=null porque la
// asignación nunca pudo guardarse.
//
// NUNCA asigna todos los contactos sin agente al ADMIN que corre el
// script — eso sería inventar una relación que no existe. Solo
// backfillea contactos donde la evidencia es inequívoca: TODAS sus
// pólizas (como TITULAR) con processedById no nulo apuntan al MISMO
// agente activo con isAgent=true (ver scripts/lib/assigned-agent-backfill.ts
// para el criterio completo de clasificación, probado en
// scripts/lib/assigned-agent-backfill.test.ts).
//
// Modo por defecto: DRY-RUN (solo cuenta y reporta, nunca escribe).
// `--apply` ejecuta el backfill real. Nunca imprime nombres de
// contactos — solo IDs técnicos y conteos agregados.
// ---------------------------------------------------------------------------

async function main() {
  const apply = process.argv.includes("--apply");

  const classified = await classifyUnassignedContacts();
  const total = classified.length;
  const unequivocal = classified.filter((c) => c.classification === "CANDIDATO_INEQUIVOCO");
  const ambiguous = classified.filter((c) => c.classification === "AMBIGUO");
  const noEvidence = classified.filter((c) => c.classification === "SIN_EVIDENCIA");

  const byAgent = new Map<string, number>();
  for (const c of unequivocal) {
    byAgent.set(c.candidateAgentId!, (byAgent.get(c.candidateAgentId!) ?? 0) + 1);
  }

  console.log(`Total de contactos sin agente asignado: ${total}`);
  console.log(`  Candidatos inequívocos: ${unequivocal.length}`);
  console.log(`  Ambiguos (nunca se tocan): ${ambiguous.length}`);
  console.log(`  Sin evidencia (nunca se tocan): ${noEvidence.length}`);
  if (byAgent.size > 0) {
    console.log("Distribución de candidatos inequívocos por agente (userId -> conteo):");
    for (const [agentId, count] of byAgent) {
      console.log(`  - ${agentId}: ${count}`);
    }
  }

  if (!apply) {
    console.log("\nDRY-RUN — no se modificó ningún dato. Ejecuta con --apply para aplicar el backfill.");
    return;
  }

  if (unequivocal.length === 0) {
    console.log("\nNada que aplicar — cero candidatos inequívocos.");
    return;
  }

  console.log(`\nAplicando backfill a ${unequivocal.length} contacto(s)...`);
  const applied = await applyBackfill(unequivocal);
  console.log(`Backfill completo: ${applied} contacto(s) actualizados.`);
}

main().finally(() => prisma.$disconnect());
