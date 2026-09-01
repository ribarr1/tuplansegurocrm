import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { listNotesForPerson, createNote } from "@/services/notes.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];

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
  createdPersonIds.push(person.id);
  return person;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-notes");
  agent = await makeActor("AGENT", "agent-notes");
  agentB = await makeActor("AGENT", "agentb-notes");
});

afterAll(async () => {
  await prisma.note.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("notes.service", () => {
  it("T) crear y listar notas — más reciente primero", async () => {
    const person = await makePerson();
    await createNote(admin, { personId: person.id, content: "Primera nota." });
    await createNote(admin, { personId: person.id, content: "Segunda nota." });
    const notes = await listNotesForPerson(admin, person.id);
    expect(notes.length).toBe(2);
    expect(notes[0].content).toBe("Segunda nota.");
  });

  it("U) minimización de datos: solo id/content/createdAt/createdBy", async () => {
    const person = await makePerson();
    const note = await createNote(admin, { personId: person.id, content: "Nota de prueba." });
    expect(Object.keys(note).sort()).toEqual(["content", "createdAt", "createdBy", "id"].sort());
  });

  it("AGENT sin acceso a la persona no puede crear nota", async () => {
    const person = await makePerson(agentB.id);
    await expect(createNote(agent, { personId: person.id, content: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("AGENT con acceso puede crear y ver notas", async () => {
    const person = await makePerson(agent.id);
    await createNote(agent, { personId: person.id, content: "Nota de agente." });
    const notes = await listNotesForPerson(agent, person.id);
    expect(notes.length).toBe(1);
  });

  it("nota vacía se rechaza", async () => {
    const person = await makePerson();
    await expect(createNote(admin, { personId: person.id, content: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
