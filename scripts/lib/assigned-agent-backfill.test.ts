import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { classifyUnassignedContacts, applyBackfill } from "./assigned-agent-backfill";

// ---------------------------------------------------------------------------
// Fase 025.5.1 (UAT-11) — backfill de Person.assignedAgentId.
//
// IMPORTANTE: classifyUnassignedContacts() opera sobre TODOS los
// Person con assignedAgentId=null de la base real de DEV, no solo los
// fixtures de este test — por eso las aserciones de este archivo nunca
// comparan conteos absolutos (esos ya se reportan aparte por el propio
// script en modo dry-run), solo verifican que LOS FIXTURES SINTÉTICOS
// de cada caso terminan en la clasificación esperada.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeAgent(overrides: { isActive?: boolean; isAgent?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      name: uniqueName("BackfillAgent"),
      email: `${uniqueName("backfillagent")}@test.local`,
      role: "AGENT",
      isActive: overrides.isActive ?? true,
      isAgent: overrides.isAgent ?? true,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeUnassignedPerson() {
  const person = await prisma.person.create({
    data: { firstName: uniqueName("Backfill"), lastName: "Test", contactStatus: "CLIENT" },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeHolderPolicy(personId: string, processedById: string | null) {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("BackfillCarrier") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("BackfillPlan"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await prisma.policy.create({
    data: {
      holderId: personId,
      productId: product.id,
      status: "PENDING",
      businessSource: "UNKNOWN",
      ...(processedById ? { processedById } : {}),
    },
  });
  createdPolicyIds.push(policy.id);
  return policy;
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdPersonIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("scripts/lib/assigned-agent-backfill — clasificación y backfill (UAT-11)", () => {
  it("un contacto sin pólizas con processedById queda SIN_EVIDENCIA (nunca se asigna)", async () => {
    const person = await makeUnassignedPerson();
    const results = await classifyUnassignedContacts();
    const mine = results.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("SIN_EVIDENCIA");
  });

  it("un contacto con TODAS sus pólizas procesadas por el MISMO agente activo+isAgent queda CANDIDATO_INEQUIVOCO", async () => {
    const agent = await makeAgent();
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, agent.id);
    await makeHolderPolicy(person.id, agent.id);

    const results = await classifyUnassignedContacts();
    const mine = results.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("CANDIDATO_INEQUIVOCO");
    expect(mine?.candidateAgentId).toBe(agent.id);
  });

  it("un contacto con pólizas procesadas por DOS agentes distintos queda AMBIGUO", async () => {
    const agentA = await makeAgent();
    const agentB = await makeAgent();
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, agentA.id);
    await makeHolderPolicy(person.id, agentB.id);

    const results = await classifyUnassignedContacts();
    const mine = results.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("AMBIGUO");
  });

  it("un contacto cuyo único agente histórico está INACTIVO queda AMBIGUO, nunca inequívoco", async () => {
    const inactiveAgent = await makeAgent({ isActive: false });
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, inactiveAgent.id);

    const results = await classifyUnassignedContacts();
    const mine = results.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("AMBIGUO");
  });

  it("un contacto cuyo único agente histórico ya NO es isAgent=true queda AMBIGUO, nunca inequívoco", async () => {
    const formerAgent = await makeAgent({ isAgent: false });
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, formerAgent.id);

    const results = await classifyUnassignedContacts();
    const mine = results.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("AMBIGUO");
  });

  it("un contacto YA asignado nunca aparece en la clasificación (nunca se sustituye una asignación existente)", async () => {
    const agent = await makeAgent();
    const person = await prisma.person.create({
      data: {
        firstName: uniqueName("AlreadyAssigned"),
        lastName: "Test",
        contactStatus: "CLIENT",
        assignedAgentId: agent.id,
      },
    });
    createdPersonIds.push(person.id);

    const results = await classifyUnassignedContacts();
    expect(results.find((r) => r.personId === person.id)).toBeUndefined();
  });

  it("applyBackfill asigna únicamente los candidatos inequívocos, auditados, y es idempotente en una segunda corrida", async () => {
    const agent = await makeAgent();
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, agent.id);

    const before = await classifyUnassignedContacts();
    const mine = before.find((r) => r.personId === person.id);
    expect(mine?.classification).toBe("CANDIDATO_INEQUIVOCO");

    const unequivocal = before.filter((r) => r.classification === "CANDIDATO_INEQUIVOCO" && r.personId === person.id);
    const appliedCount = await applyBackfill(unequivocal);
    expect(appliedCount).toBe(1);

    const updated = await prisma.person.findUniqueOrThrow({ where: { id: person.id }, select: { assignedAgentId: true } });
    expect(updated.assignedAgentId).toBe(agent.id);

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: "Person", entityId: person.id, action: "CONTACT_ASSIGN_AGENT", actorType: "SYSTEM" },
    });
    expect(event).toBeTruthy();
    const changes = event?.changes as { assignedAgentId?: { before: string | null; after: string } } | null;
    expect(changes?.assignedAgentId?.before).toBeNull();
    expect(changes?.assignedAgentId?.after).toBe(agent.id);

    // Segunda corrida: el contacto ya no aparece sin asignar, y aplicar
    // de nuevo la misma lista clasificada no vuelve a escribir nada
    // (re-verificación dentro de la transacción).
    const afterFirstRun = await classifyUnassignedContacts();
    expect(afterFirstRun.find((r) => r.personId === person.id)).toBeUndefined();

    const secondAppliedCount = await applyBackfill(unequivocal);
    expect(secondAppliedCount).toBe(0);
  });

  it("classifyUnassignedContacts (dry-run) nunca modifica datos", async () => {
    const agent = await makeAgent();
    const person = await makeUnassignedPerson();
    await makeHolderPolicy(person.id, agent.id);

    await classifyUnassignedContacts();
    await classifyUnassignedContacts();

    const stillUnassigned = await prisma.person.findUniqueOrThrow({
      where: { id: person.id },
      select: { assignedAgentId: true },
    });
    expect(stillUnassigned.assignedAgentId).toBeNull();
  });
});
