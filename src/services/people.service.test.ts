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
  label: string
): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-svc");
  agent = await makeActor("AGENT", "agent-svc");
  agentB = await makeActor("AGENT", "agentb-svc");
  assistant = await makeActor("ASSISTANT", "assistant-svc");
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
});
