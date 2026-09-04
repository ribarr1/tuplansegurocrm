import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listAgentPortalCredentials,
  createAgentPortalCredential,
  updateAgentPortalCredential,
  deactivateAgentPortalCredential,
  revealAgentPortalCredentialField,
  recordAgentPortalCredentialCopy,
} from "@/services/agent-portal-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 025 (Parte J) — vault de credenciales de portal del AGENTE.
// Usa SOLO secretos ficticios (nunca reales) — ver CLAUDE.md.

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${role} Vault Test`,
      email: `${role.toLowerCase()}.vault.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdCredentialIds } } });
  await prisma.agentPortalCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("agent-portal-credentials.service", () => {
  it("A) ADMIN crea una credencial y nunca se devuelve el password en texto plano por defecto", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "Ambetter Agent Portal (fixture)",
      portalUrl: "https://agent.ambetter.example",
      username: "fixture.user",
      password: "Fixture-Password-123!",
    });
    createdCredentialIds.push(created.id);
    expect(created.usernameMasked).toBe("••••••••");
    expect(created.passwordMasked).toBe("••••••••••••");
    expect(JSON.stringify(created)).not.toContain("Fixture-Password-123!");
  });

  it("B) la contraseña se guarda cifrada en DB, nunca en texto plano", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "BCBS Producer Portal (fixture)",
      portalUrl: "https://producer.bcbs.example",
      username: "fixture.user2",
      password: "Fixture-Password-456!",
    });
    createdCredentialIds.push(created.id);

    const row = await prisma.agentPortalCredential.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.passwordEncrypted).not.toContain("Fixture-Password-456!");
    expect(row.passwordEncrypted.startsWith("v1:")).toBe(true);
  });

  it("C) reveal devuelve el valor real y descifra correctamente (round-trip)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "Oscar Broker Portal (fixture)",
      portalUrl: "https://broker.oscar.example",
      username: "fixture.user3",
      password: "Fixture-Password-789!",
    });
    createdCredentialIds.push(created.id);

    const revealed = await revealAgentPortalCredentialField(admin, created.id, "password");
    expect(revealed).toBe("Fixture-Password-789!");
  });

  it("D) AGENT puede revelar solo sus propias credenciales, nunca las de otro agente", async () => {
    const admin = await makeActor("ADMIN");
    const agentA = await makeActor("AGENT");
    const agentB = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agentA.id,
      portalName: "Cigna Portal (fixture)",
      portalUrl: "https://portal.cigna.example",
      username: "fixture.user4",
      password: "Fixture-Password-000!",
    });
    createdCredentialIds.push(created.id);

    await expect(revealAgentPortalCredentialField(agentA, created.id, "password")).resolves.toBe(
      "Fixture-Password-000!"
    );
    await expect(revealAgentPortalCredentialField(agentB, created.id, "password")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("E) ASSISTANT no tiene ningún acceso (ni listar ni revelar)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const assistant = await makeActor("ASSISTANT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "AmeriHealth Portal (fixture)",
      portalUrl: "https://portal.amerihealth.example",
      username: "fixture.user5",
      password: "Fixture-Password-111!",
    });
    createdCredentialIds.push(created.id);

    await expect(listAgentPortalCredentials(assistant, agent.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revealAgentPortalCredentialField(assistant, created.id, "password")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("F) el AuditEvent de creación/reveal/copia NUNCA contiene el secreto", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "SelectHealth Portal (fixture)",
      portalUrl: "https://portal.selecthealth.example",
      username: "fixture.secretuser",
      password: "Fixture-Secret-Password!",
    });
    createdCredentialIds.push(created.id);
    await revealAgentPortalCredentialField(admin, created.id, "password");
    await recordAgentPortalCredentialCopy(admin, created.id, "password");

    const events = await prisma.auditEvent.findMany({ where: { entityId: created.id } });
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Fixture-Secret-Password!");
    expect(serialized).not.toContain("fixture.secretuser");
    expect(events.some((e) => e.action === "CREDENTIAL_CREATED")).toBe(true);
    expect(events.some((e) => e.action === "CREDENTIAL_PASSWORD_REVEALED")).toBe(true);
    expect(events.some((e) => e.action === "CREDENTIAL_PASSWORD_COPIED")).toBe(true);
  });

  it("G) actualizar username/password re-cifra sin dejar el valor anterior en el diff auditado", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "Molina Portal (fixture)",
      portalUrl: "https://portal.molina.example",
      username: "fixture.old",
      password: "Fixture-Old-Password!",
    });
    createdCredentialIds.push(created.id);

    await updateAgentPortalCredential(admin, created.id, { password: "Fixture-New-Password!" });
    const revealed = await revealAgentPortalCredentialField(admin, created.id, "password");
    expect(revealed).toBe("Fixture-New-Password!");

    const events = await prisma.auditEvent.findMany({ where: { entityId: created.id, action: "CREDENTIAL_UPDATED" } });
    expect(JSON.stringify(events)).not.toContain("Fixture-Old-Password!");
    expect(JSON.stringify(events)).not.toContain("Fixture-New-Password!");
  });

  it("H) desactivar nunca borra la fila (soft delete) y se conserva en historial", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const created = await createAgentPortalCredential(admin, {
      userId: agent.id,
      portalName: "Kaiser Portal (fixture)",
      portalUrl: "https://portal.kaiser.example",
      username: "fixture.deact",
      password: "Fixture-Deact-Password!",
    });
    createdCredentialIds.push(created.id);

    const deactivated = await deactivateAgentPortalCredential(admin, created.id);
    expect(deactivated.isActive).toBe(false);
    const stillThere = await prisma.agentPortalCredential.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();
  });
});
