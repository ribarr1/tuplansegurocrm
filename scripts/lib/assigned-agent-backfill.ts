import { prisma } from "../../src/lib/prisma";

// ---------------------------------------------------------------------------
// Fase 025.5.1 (UAT-11) — lógica de clasificación/backfill de
// Person.assignedAgentId, extraída de scripts/backfill-assigned-agent.ts
// para poder probarla con Vitest (el script en sí no importa nada con
// "server-only", así que este módulo tampoco — se usa tanto desde el
// script de línea de comandos como desde el test de integración).
//
// Ver scripts/backfill-assigned-agent.ts para la explicación completa
// del criterio de clasificación.
// ---------------------------------------------------------------------------

export type BackfillClassification = "CANDIDATO_INEQUIVOCO" | "AMBIGUO" | "SIN_EVIDENCIA";

export interface ClassifiedContact {
  personId: string;
  classification: BackfillClassification;
  candidateAgentId?: string;
}

export async function classifyUnassignedContacts(): Promise<ClassifiedContact[]> {
  const unassigned = await prisma.person.findMany({
    where: { assignedAgentId: null },
    select: {
      id: true,
      holderPolicies: { select: { processedById: true } },
    },
  });

  const allProcessorIds = new Set<string>();
  for (const p of unassigned) {
    for (const policy of p.holderPolicies) {
      if (policy.processedById) allProcessorIds.add(policy.processedById);
    }
  }
  const agents = await prisma.user.findMany({
    where: { id: { in: [...allProcessorIds] } },
    select: { id: true, isActive: true, isAgent: true },
  });
  const eligibleAgentIds = new Set(agents.filter((a) => a.isActive && a.isAgent).map((a) => a.id));
  const knownProcessorIds = new Set(agents.map((a) => a.id));

  const results: ClassifiedContact[] = [];
  for (const p of unassigned) {
    const processedByIds = [
      ...new Set(p.holderPolicies.map((pol) => pol.processedById).filter((v): v is string => !!v)),
    ];

    if (processedByIds.length === 0) {
      results.push({ personId: p.id, classification: "SIN_EVIDENCIA" });
      continue;
    }
    if (processedByIds.length > 1) {
      results.push({ personId: p.id, classification: "AMBIGUO" });
      continue;
    }
    const onlyAgentId = processedByIds[0];
    // No debería pasar (todo processedById viene de un Policy real con FK
    // a User), pero si el usuario ya no existiera, tratarlo como ambiguo
    // en vez de asumir nada.
    if (!knownProcessorIds.has(onlyAgentId) || !eligibleAgentIds.has(onlyAgentId)) {
      results.push({ personId: p.id, classification: "AMBIGUO" });
      continue;
    }
    results.push({ personId: p.id, classification: "CANDIDATO_INEQUIVOCO", candidateAgentId: onlyAgentId });
  }
  return results;
}

// Aplica el backfill EXCLUSIVAMENTE sobre candidatos inequívocos, uno
// por uno en su propia transacción (Person.update + AuditEvent), nunca
// en bloque sin auditoría individual. Re-verifica dentro de la
// transacción que el contacto SIGUE sin asignar (nunca sobrescribe una
// asignación hecha entre clasificar y aplicar) — por eso es idempotente:
// una segunda corrida sobre los mismos candidatos ya asignados no hace
// nada (classifyUnassignedContacts ya no los devuelve, al no tener
// assignedAgentId=null).
export async function applyBackfill(unequivocal: ClassifiedContact[]): Promise<number> {
  let applied = 0;
  for (const c of unequivocal) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.person.findUnique({ where: { id: c.personId }, select: { assignedAgentId: true } });
      if (!current || current.assignedAgentId !== null) return;

      await tx.person.update({ where: { id: c.personId }, data: { assignedAgentId: c.candidateAgentId! } });
      await tx.auditEvent.create({
        data: {
          actorUserId: null,
          actorType: "SYSTEM",
          entityType: "Person",
          entityId: c.personId,
          action: "CONTACT_ASSIGN_AGENT",
          contactPersonId: c.personId,
          summary:
            "Agente asignado por backfill automático (Fase 025.5.1, UAT-11) — candidato inequívoco por processedById histórico",
          changes: { assignedAgentId: { before: null, after: c.candidateAgentId! } },
        },
      });
      applied++;
    });
  }
  return applied;
}
