import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listClientPortalCredentials,
  createClientPortalCredential,
  revealClientPortalCredentialField,
} from "@/services/client-portal-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 025 (Parte J) — vault de credenciales de portal del CLIENTE.
// Usa SOLO secretos ficticios (nunca reales).

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCredentialIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${role} ClientVault Test`,
      email: `${role.toLowerCase()}.cvault.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
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
      firstName: "Vault",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdCredentialIds } } });
  await prisma.clientPortalCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("client-portal-credentials.service", () => {
  it("A) ADMIN crea una credencial STATE_EXCHANGE sin carrier (nunca fabrica un carrier falso)", async () => {
    const admin = await makeActor("ADMIN");
    const person = await makePerson();
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "STATE_EXCHANGE",
      portalName: "Get Covered Illinois (fixture)",
      portalUrl: "https://getcovered.example",
      username: "fixture.client",
      password: "Fixture-Client-Password!",
    });
    createdCredentialIds.push(created.id);
    expect(created.carrierId).toBeNull();
    expect(created.portalType).toBe("STATE_EXCHANGE");
  });

  it("B) reveal hace round-trip correcto del password real", async () => {
    const admin = await makeActor("ADMIN");
    const person = await makePerson();
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "CARRIER",
      portalName: "Ambetter Client Portal (fixture)",
      portalUrl: "https://member.ambetter.example",
      username: "fixture.client2",
      password: "Fixture-Client-Password-2!",
    });
    createdCredentialIds.push(created.id);
    const revealed = await revealClientPortalCredentialField(admin, created.id, "password");
    expect(revealed).toBe("Fixture-Client-Password-2!");
  });

  it("C) AGENT con acceso operativo puede revelar; sin acceso, FORBIDDEN", async () => {
    const admin = await makeActor("ADMIN");
    const agentOwner = await makeActor("AGENT");
    const agentOther = await makeActor("AGENT");
    const person = await makePerson(agentOwner.id);
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "MARKETPLACE",
      portalName: "Healthcare.gov (fixture)",
      portalUrl: "https://healthcare.gov",
      username: "fixture.client3",
      password: "Fixture-Client-Password-3!",
    });
    createdCredentialIds.push(created.id);

    await expect(revealClientPortalCredentialField(agentOwner, created.id, "password")).resolves.toBe(
      "Fixture-Client-Password-3!"
    );
    await expect(revealClientPortalCredentialField(agentOther, created.id, "password")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("D) ASSISTANT puede LISTAR (gestionar) pero nunca REVELAR el secreto", async () => {
    const admin = await makeActor("ADMIN");
    const assistant = await makeActor("ASSISTANT");
    const person = await makePerson();
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "OTHER",
      portalName: "Otro portal (fixture)",
      portalUrl: "https://otro.example",
      username: "fixture.client4",
      password: "Fixture-Client-Password-4!",
    });
    createdCredentialIds.push(created.id);

    const list = await listClientPortalCredentials(assistant, person.id);
    expect(list.items.some((c) => c.id === created.id)).toBe(true);
    expect(list.canReveal).toBe(false);

    await expect(revealClientPortalCredentialField(assistant, created.id, "password")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("E) el listado nunca expone username/password en texto plano", async () => {
    const admin = await makeActor("ADMIN");
    const person = await makePerson();
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "CARRIER",
      portalName: "Oscar Client Portal (fixture)",
      portalUrl: "https://member.oscar.example",
      username: "fixture.secretclient",
      password: "Fixture-Secret-Client-Password!",
    });
    createdCredentialIds.push(created.id);

    const list = await listClientPortalCredentials(admin, person.id);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("Fixture-Secret-Client-Password!");
    expect(serialized).not.toContain("fixture.secretclient");
  });

  it("F) AuditEvent de creación/reveal nunca contiene el secreto, y siempre queda contactPersonId", async () => {
    const admin = await makeActor("ADMIN");
    const person = await makePerson();
    const created = await createClientPortalCredential(admin, {
      personId: person.id,
      portalType: "CARRIER",
      portalName: "Cigna Client Portal (fixture)",
      portalUrl: "https://member.cigna.example",
      username: "fixture.auditclient",
      password: "Fixture-Audit-Client-Password!",
    });
    createdCredentialIds.push(created.id);
    await revealClientPortalCredentialField(admin, created.id, "username");

    const events = await prisma.auditEvent.findMany({ where: { entityId: created.id } });
    expect(events.every((e) => e.contactPersonId === person.id)).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Fixture-Audit-Client-Password!");
    expect(serialized).not.toContain("fixture.auditclient");
  });
});
