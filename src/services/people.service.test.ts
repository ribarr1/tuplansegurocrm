import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createPerson,
  getPersonById,
  updatePerson,
  listPeople,
  canEditPerson,
} from "@/services/people.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];

function track<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}

async function makeActor(
  role: "ADMIN" | "AGENT" | "ASSISTANT",
  label: string,
  overrides: { isAgent?: boolean; isActive?: boolean } = {}
): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2)}@test.local`,
      role,
      isActive: overrides.isActive ?? true,
      // Fase 025.5.1 (UAT-11): assertActiveAgent ahora exige
      // isAgent=true (nunca role==="AGENT") — un fixture crudo vía
      // prisma.user.create debe replicarlo a mano, igual que
      // createUser() ya hace en el servicio real.
      isAgent: overrides.isAgent ?? role === "AGENT",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;
let adminAgent: AuthorizedUser;
let adminNonAgent: AuthorizedUser;
let inactiveAgent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-svc");
  agent = await makeActor("AGENT", "agent-svc");
  agentB = await makeActor("AGENT", "agentb-svc");
  assistant = await makeActor("ASSISTANT", "assistant-svc");
  // UAT-11: un ADMIN que también es agente (ej. el dueño de la
  // agencia) — el caso real que el bug rechazaba en updatePerson.
  adminAgent = await makeActor("ADMIN", "adminagent-svc", { isAgent: true });
  adminNonAgent = await makeActor("ADMIN", "adminnonagent-svc", { isAgent: false });
  inactiveAgent = await makeActor("AGENT", "inactiveagent-svc", { isActive: false });
});

afterAll(async () => {
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("people.service", () => {
  it("A) ADMIN crea Person correctamente", async () => {
    const p = track(await createPerson(admin, { firstName: "Ana", lastName: "Gomez" }));
    expect(p.firstName).toBe("Ana");
    expect(p.assignedAgent).toBeNull();
  });

  // Fase 024 (Hallazgo #1 de UAT): Person.sex.
  it("crea Person con sex explícito", async () => {
    const p = track(await createPerson(admin, { firstName: "SexF", lastName: "Test", sex: "FEMALE" }));
    expect(p.sex).toBe("FEMALE");
  });

  it("crea Person sin sex -> UNKNOWN por default (nunca se infiere del nombre)", async () => {
    const p = track(await createPerson(admin, { firstName: "SinSexo", lastName: "Test" }));
    expect(p.sex).toBe("UNKNOWN");
  });

  it("edita el sexo de una Person existente", async () => {
    const p = track(await createPerson(admin, { firstName: "EditSex", lastName: "Test" }));
    expect(p.sex).toBe("UNKNOWN");
    const updated = await updatePerson(admin, p.id, { sex: "MALE" });
    expect(updated.sex).toBe("MALE");
  });

  it("actualizar sin enviar sex nunca lo resetea a UNKNOWN (mismo bug class que contactStatus)", async () => {
    const p = track(await createPerson(admin, { firstName: "KeepSex", lastName: "Test", sex: "OTHER" }));
    const updated = await updatePerson(admin, p.id, { phone: "5551234567" });
    expect(updated.sex).toBe("OTHER");
  });

  it("B) AGENT crea Person y queda asignada a sí mismo (ignora assignedAgentId enviado)", async () => {
    const p = track(
      await createPerson(agent, { firstName: "Bob", lastName: "Perez", assignedAgentId: admin.id })
    );
    expect(p.assignedAgentId).toBe(agent.id);
  });

  it("C) ASSISTANT crea Person sin asignar (ignora assignedAgentId enviado)", async () => {
    const p = track(
      await createPerson(assistant, { firstName: "Cara", lastName: "Diaz", assignedAgentId: agent.id })
    );
    expect(p.assignedAgentId).toBeNull();
  });

  it("D) email inválido rechazado", async () => {
    await expect(
      createPerson(admin, { firstName: "X", lastName: "Y", email: "not-an-email" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("E) UUID inválido en getPerson rechazado antes de Prisma", async () => {
    await expect(getPersonById(admin, "not-a-uuid")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("F) Person inexistente devuelve NOT_FOUND controlado", async () => {
    await expect(
      getPersonById(admin, "00000000-0000-0000-0000-000000000000")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("G) update no permite campos fuera de whitelist (id/createdAt no cambian)", async () => {
    const p = track(await createPerson(admin, { firstName: "Gina", lastName: "Wtest" }));
    const updated = await updatePerson(admin, p.id, {
      firstName: "Gina2",
      id: "hacked-id",
      createdAt: "2000-01-01",
    } as unknown);
    expect(updated.firstName).toBe("Gina2");
    expect(updated.id).toBe(p.id);
    expect(updated.createdAt).toEqual(p.createdAt);
  });

  it("H) listPeople pagina correctamente", async () => {
    const marker = `PagTest${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      track(await createPerson(admin, { firstName: `P${i}`, lastName: marker }));
    }
    const page1 = await listPeople(admin, { page: 1, pageSize: 2, search: marker });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(3);
    const page2 = await listPeople(admin, { page: 2, pageSize: 2, search: marker });
    expect(page2.items.length).toBe(1);
  });

  it("I) search encuentra por nombre", async () => {
    const uniqueLast = `SearchLast${Date.now()}`;
    const p = track(await createPerson(admin, { firstName: "Zelda", lastName: uniqueLast }));
    const result = await listPeople(admin, { search: uniqueLast });
    expect(result.items.some((i) => i.id === p.id)).toBe(true);
  });

  it("J) search encuentra por phone/email", async () => {
    const uniquePhone = `555${Date.now()}`.slice(0, 10);
    const p = track(
      await createPerson(admin, { firstName: "Phone", lastName: "Test", phone: uniquePhone })
    );
    const result = await listPeople(admin, { search: uniquePhone });
    expect(result.items.some((i) => i.id === p.id)).toBe(true);
  });

  it("K) contactStatus filter funciona", async () => {
    const marker = `CSFilter${Date.now()}`;
    // createPerson siempre fuerza PROSPECT (Fase 022, Hallazgo #2) — el
    // estado CLIENT de este fixture se fija con un update directo,
    // fuera de la regla normal (no es lo que este test cubre).
    const client = track(await createPerson(admin, { firstName: marker, lastName: "C" }));
    await prisma.person.update({ where: { id: client.id }, data: { contactStatus: "CLIENT" } });
    const prospect = track(
      await createPerson(admin, { firstName: marker, lastName: "P", contactStatus: "PROSPECT" })
    );
    const result = await listPeople(admin, { search: marker, contactStatus: "CLIENT" });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(client.id);
    expect(ids).not.toContain(prospect.id);
  });

  it("UAT-11: filtro assignedAgentId devuelve solo contactos de ese agente, nunca por Policy.processedById", async () => {
    const marker = `AgentFilter${Date.now()}`;
    const assigned = track(
      await createPerson(admin, { firstName: marker, lastName: "Assigned", assignedAgentId: agent.id })
    );
    const other = track(
      await createPerson(admin, { firstName: marker, lastName: "Other", assignedAgentId: agentB.id })
    );
    const result = await listPeople(admin, { search: marker, assignedAgentId: agent.id });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(assigned.id);
    expect(ids).not.toContain(other.id);
  });

  it("UAT-11: filtro assignedAgentId='unassigned' devuelve solo contactos sin agente", async () => {
    const marker = `UnassignedFilter${Date.now()}`;
    const unassigned = track(await createPerson(assistant, { firstName: marker, lastName: "None" }));
    const assigned = track(
      await createPerson(admin, { firstName: marker, lastName: "Has", assignedAgentId: agent.id })
    );
    const result = await listPeople(admin, { search: marker, assignedAgentId: "unassigned" });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(unassigned.id);
    expect(ids).not.toContain(assigned.id);
  });

  it("UAT-11: filtro por agente se combina correctamente con contactStatus y búsqueda", async () => {
    const marker = `Combined${Date.now()}`;
    const match = track(
      await createPerson(admin, { firstName: marker, lastName: "Match", assignedAgentId: agent.id })
    );
    await prisma.person.update({ where: { id: match.id }, data: { contactStatus: "CLIENT" } });
    const wrongStatus = track(
      await createPerson(admin, { firstName: marker, lastName: "WrongStatus", assignedAgentId: agent.id })
    );
    const result = await listPeople(admin, {
      search: marker,
      assignedAgentId: agent.id,
      contactStatus: "CLIENT",
    });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(match.id);
    expect(ids).not.toContain(wrongStatus.id);
  });

  it("AGENT solo puede editar personas sin asignar o asignadas a sí mismo", async () => {
    const own = track(await createPerson(agent, { firstName: "Own", lastName: "Test" }));
    const updatedOwn = await updatePerson(agent, own.id, { firstName: "OwnUpdated" });
    expect(updatedOwn.firstName).toBe("OwnUpdated");

    const other = track(await createPerson(agentB, { firstName: "Other", lastName: "Test" }));
    await expect(updatePerson(agent, other.id, { firstName: "Hacked" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("solo ADMIN puede reasignar assignedAgentId en un update", async () => {
    const p = track(await createPerson(admin, { firstName: "Reassign", lastName: "Test" }));
    await expect(
      updatePerson(agent, p.id, { assignedAgentId: agent.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const updated = await updatePerson(admin, p.id, { assignedAgentId: agent.id });
    expect(updated.assignedAgentId).toBe(agent.id);
  });

  it("assignedAgentId debe ser un AGENT activo (ADMIN no puede asignar a un ASSISTANT)", async () => {
    await expect(
      createPerson(admin, { firstName: "Bad", lastName: "Assign", assignedAgentId: assistant.id })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // canEditPerson es la misma función que usa la UI (contacts/[id]/edit)
  // para decidir si mostrar el formulario o "no autorizado" — probarla
  // directamente cubre esa decisión de presentación sin duplicar lógica.
  it("canEditPerson refleja exactamente la política de edición", () => {
    expect(canEditPerson(admin, { assignedAgentId: agentB.id })).toBe(true);
    expect(canEditPerson(assistant, { assignedAgentId: agentB.id })).toBe(true);
    expect(canEditPerson(agent, { assignedAgentId: null })).toBe(true);
    expect(canEditPerson(agent, { assignedAgentId: agent.id })).toBe(true);
    expect(canEditPerson(agent, { assignedAgentId: agentB.id })).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Fase 025.5.1 (UAT-11) — la columna "Agente asignado" de Contactos
  // aparecía vacía porque assertActiveAgent exigía role==="AGENT",
  // rechazando en silencio a cualquier ADMIN+isAgent=true (ej. el dueño
  // de la agencia) aunque el selector de la UI ya lo mostrara (esa lista
  // usa listActiveAgents, que sí filtra por isAgent). Root cause: dos
  // funciones distintas con criterios de elegibilidad distintos para el
  // mismo concepto de negocio.
  // ---------------------------------------------------------------------
  describe("UAT-11 — assignedAgentId usa isAgent, nunca role", () => {
    it("un ADMIN+isAgent=true puede asignarse como agente de un contacto (caso real del bug)", async () => {
      const p = track(await createPerson(admin, { firstName: "AdminAgent", lastName: "Case" }));
      const updated = await updatePerson(admin, p.id, { assignedAgentId: adminAgent.id });
      expect(updated.assignedAgentId).toBe(adminAgent.id);
      expect(updated.assignedAgent?.id).toBe(adminAgent.id);
    });

    it("un ADMIN sin isAgent=true (no vende) NUNCA puede recibir contactos asignados", async () => {
      await expect(
        createPerson(admin, { firstName: "Bad", lastName: "AdminNonAgent", assignedAgentId: adminNonAgent.id })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("un AGENT inactivo (isActive=false) nunca puede recibir contactos asignados", async () => {
      await expect(
        createPerson(admin, { firstName: "Bad", lastName: "InactiveAgent", assignedAgentId: inactiveAgent.id })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("ASSISTANT sigue excluido del selector de agente", async () => {
      await expect(
        createPerson(admin, { firstName: "Bad", lastName: "AssistantCase", assignedAgentId: assistant.id })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("enviar assignedAgentId='' desasigna explícitamente un contacto que ya tenía agente", async () => {
      const p = track(
        await createPerson(admin, { firstName: "Unassign", lastName: "Case", assignedAgentId: agent.id })
      );
      const updated = await updatePerson(admin, p.id, { assignedAgentId: "" });
      expect(updated.assignedAgentId).toBeNull();
      expect(updated.assignedAgent).toBeNull();
    });

    it("un contacto realmente sin asignación queda assignedAgentId=null (no un guion ambiguo en el servicio)", async () => {
      const p = track(await createPerson(assistant, { firstName: "NoAgent", lastName: "Case" }));
      expect(p.assignedAgentId).toBeNull();
    });

    it("la reasignación (agent -> agentB) queda auditada con el agente anterior y el nuevo, sin PII innecesaria", async () => {
      const p = track(
        await createPerson(admin, { firstName: "Audit", lastName: "Case", assignedAgentId: agent.id })
      );
      await updatePerson(admin, p.id, { assignedAgentId: agentB.id });

      const event = await prisma.auditEvent.findFirst({
        where: { entityType: "Person", entityId: p.id, action: "CONTACT_ASSIGN_AGENT" },
        orderBy: { createdAt: "desc" },
      });
      expect(event).toBeTruthy();
      expect(event?.actorUserId).toBe(admin.id);
      const changes = event?.changes as { assignedAgentId?: { before: string | null; after: string | null } } | null;
      expect(changes?.assignedAgentId?.before).toBe(agent.id);
      expect(changes?.assignedAgentId?.after).toBe(agentB.id);
    });
  });
});
