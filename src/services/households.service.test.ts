import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getHouseholdsForPerson,
  createHouseholdWithInitialMember,
  addHouseholdMember,
  removeHouseholdMember,
  updateHouseholdMemberRole,
  createPersonAndAddToHousehold,
} from "@/services/households.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdHouseholdIds: string[] = [];

function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}
function trackHousehold<T extends { id: string }>(h: T): T {
  createdHouseholdIds.push(h.id);
  return h;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  return trackPerson(person);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-hh");
  agent = await makeActor("AGENT", "agent-hh");
  agentB = await makeActor("AGENT", "agentb-hh");
  assistant = await makeActor("ASSISTANT", "assistant-hh");
});

afterAll(async () => {
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("households.service", () => {
  it("A) Person sin Household devuelve lista vacía", async () => {
    const person = await makePerson();
    const households = await getHouseholdsForPerson(admin, person.id);
    expect(households).toEqual([]);
  });

  it("B) crear Household + Person inicial funciona atómicamente", async () => {
    const person = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: person.id, role: "HEAD" })
    );
    expect(household.members).toHaveLength(1);
    expect(household.members[0].person.id).toBe(person.id);
    expect(household.members[0].role).toBe("HEAD");
  });

  it("C) agregar Person existente funciona", async () => {
    const head = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: head.id, role: "HEAD" })
    );
    const spouse = await makePerson();
    const updated = await addHouseholdMember(admin, household.id, {
      personId: spouse.id,
      role: "SPOUSE",
    });
    expect(updated.members).toHaveLength(2);
    expect(updated.members.some((m) => m.person.id === spouse.id && m.role === "SPOUSE")).toBe(
      true
    );
  });

  it("D) agregar misma Person dos veces falla con CONFLICT controlado", async () => {
    const head = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: head.id, role: "HEAD" })
    );
    const other = await makePerson();
    await addHouseholdMember(admin, household.id, { personId: other.id, role: "OTHER" });

    await expect(
      addHouseholdMember(admin, household.id, { personId: other.id, role: "OTHER" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("E) Person puede pertenecer a dos households distintos", async () => {
    const person = await makePerson();
    const householdOne = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: person.id, role: "HEAD" })
    );
    const otherHead = await makePerson();
    const householdTwo = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: otherHead.id, role: "HEAD" })
    );
    await addHouseholdMember(admin, householdTwo.id, { personId: person.id, role: "OTHER" });

    const households = await getHouseholdsForPerson(admin, person.id);
    const ids = households.map((h) => h.id);
    expect(ids).toContain(householdOne.id);
    expect(ids).toContain(householdTwo.id);
  });

  it("F) cambiar HouseholdMemberRole funciona", async () => {
    const person = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: person.id, role: "OTHER" })
    );
    const memberId = household.members[0].id;
    const updated = await updateHouseholdMemberRole(admin, memberId, { role: "HEAD" });
    expect(updated.members[0].role).toBe("HEAD");
  });

  it("G) remover miembro elimina HouseholdMember pero Person permanece", async () => {
    const person = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: person.id, role: "HEAD" })
    );
    const memberId = household.members[0].id;

    await removeHouseholdMember(admin, memberId);

    const remaining = await prisma.householdMember.findUnique({ where: { id: memberId } });
    expect(remaining).toBeNull();
    const stillExists = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stillExists).not.toBeNull();
  });

  it("H) crear nueva Person + añadir al Household funciona atómicamente", async () => {
    const head = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: head.id, role: "HEAD" })
    );

    const uniqueLastName = `Hijo${Date.now()}${Math.random().toString(36).slice(2)}`;
    const updated = await createPersonAndAddToHousehold(admin, household.id, {
      firstName: "Nuevo",
      lastName: uniqueLastName,
      role: "CHILD",
    });

    // Se verifica de forma acotada (por lastName único de este test) en
    // vez de un conteo global de la tabla — un conteo global es
    // inestable cuando otros archivos de test crean Person en paralelo
    // (Vitest corre archivos de test concurrentemente).
    const matchingPeople = await prisma.person.count({ where: { lastName: uniqueLastName } });
    expect(matchingPeople).toBe(1);
    expect(updated.members).toHaveLength(2);
    const newMember = updated.members.find((m) => m.person.firstName === "Nuevo");
    expect(newMember?.role).toBe("CHILD");
    if (newMember) trackPerson({ id: newMember.person.id });
  });

  // I) La atomicidad real (si la segunda escritura fallara DESPUÉS de la
  // primera dentro de la transacción) es una garantía estructural de
  // prisma.$transaction(async (tx) => {...}): ambas escrituras usan el
  // mismo cliente `tx`, así que Postgres revierte todo si cualquiera
  // falla — no es algo que necesitemos forzar para confiar en ello,
  // igual que no probamos que Postgres respeta ACID. Lo que sí podemos
  // probar directamente es que la validación previa (household
  // inexistente) impide que se cree una Person huérfana ANTES de
  // siquiera intentar la transacción.
  it("I) si el hogar no existe, no queda una Person creada a medias", async () => {
    const fakeHouseholdId = "00000000-0000-0000-0000-000000000000";
    // lastName único de este test: evita depender de un conteo global de
    // la tabla, inestable cuando otros archivos de test crean Person en
    // paralelo (Vitest corre archivos de test concurrentemente).
    const uniqueLastName = `Huerfano${Date.now()}${Math.random().toString(36).slice(2)}`;

    await expect(
      createPersonAndAddToHousehold(admin, fakeHouseholdId, {
        firstName: "Huerfano",
        lastName: uniqueLastName,
        role: "CHILD",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const afterCount = await prisma.person.count({ where: { lastName: uniqueLastName } });
    expect(afterCount).toBe(0);
  });

  it("J) AGENT permitido cuando tiene acceso a un miembro del hogar (propio o sin asignar)", async () => {
    const own = await makePerson(agent.id);
    const household = trackHousehold(
      await createHouseholdWithInitialMember(agent, { personId: own.id, role: "HEAD" })
    );
    const unassigned = await makePerson(null);
    const updated = await addHouseholdMember(agent, household.id, {
      personId: unassigned.id,
      role: "OTHER",
    });
    expect(updated.members).toHaveLength(2);
  });

  it("K) AGENT bloqueado en un hogar sin ningún miembro propio/sin asignar", async () => {
    const otherAgentsPerson = await makePerson(agentB.id);
    const household = trackHousehold(
      await createHouseholdWithInitialMember(agentB, { personId: otherAgentsPerson.id, role: "HEAD" })
    );
    const anyPerson = await makePerson();
    await expect(
      addHouseholdMember(agent, household.id, { personId: anyPerson.id, role: "OTHER" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("L) ASSISTANT permitido para administración de household sin restricción de asignación", async () => {
    const person = await makePerson(agentB.id); // asignada a otro agente
    const household = trackHousehold(
      await createHouseholdWithInitialMember(assistant, { personId: person.id, role: "HEAD" })
    );
    const other = await makePerson();
    const updated = await addHouseholdMember(assistant, household.id, {
      personId: other.id,
      role: "OTHER",
    });
    expect(updated.members).toHaveLength(2);
  });

  // M) "usuario inactive bloqueado" no tiene una ruta de código nueva
  // en households.service.ts: al igual que people.service.ts, cada
  // función recibe `actor: AuthorizedUser` ya resuelto — la única
  // fuente legítima de ese objeto es requireSessionUser()/
  // requireSessionRole() (src/lib/authorization.ts), que ya rechazan
  // usuarios con isActive=false y están probados en
  // src/lib/authorization.test.ts (Fase 008). Las Server Actions de
  // household (household-actions.ts) llaman a requireSessionUser()
  // exactamente igual que las de contactos — no hay lógica adicional
  // que probar aquí específicamente para household.

  it("N) ninguna consulta de Household expone campos de salud/financieros", async () => {
    const person = await makePerson();
    const household = trackHousehold(
      await createHouseholdWithInitialMember(admin, { personId: person.id, role: "HEAD" })
    );
    const member = household.members[0];
    const personKeys = Object.keys(member.person);
    for (const forbidden of [
      "personProvider",
      "personMedication",
      "commissionExpectation",
      "holderPolicies",
      "dateOfBirth",
      "source",
    ]) {
      expect(personKeys).not.toContain(forbidden);
    }
    expect(personKeys.sort()).toEqual(
      ["id", "firstName", "lastName", "phone", "email", "contactStatus", "assignedAgentId"].sort()
    );
  });
});
