import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { listAgentLicenses, createAgentLicense, updateAgentLicense } from "@/services/agent-licenses.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdLicenseIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${role} License Test`,
      email: `${role.toLowerCase()}.lic.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdLicenseIds } } });
  await prisma.agentLicense.deleteMany({ where: { id: { in: createdLicenseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("agent-licenses.service", () => {
  it("A) ADMIN crea una licencia", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "IL", status: "ACTIVE" });
    createdLicenseIds.push(license.id);
    expect(license.state).toBe("IL");
    expect(license.status).toBe("ACTIVE");
  });

  it("B) AGENT no puede crear licencias (FORBIDDEN)", async () => {
    const agent = await makeActor("AGENT");
    await expect(
      createAgentLicense(agent, { userId: agent.id, state: "TX", status: "ACTIVE" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("C) rechaza una segunda licencia para el mismo (userId, state)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "FL", status: "ACTIVE" });
    createdLicenseIds.push(license.id);
    await expect(
      createAgentLicense(admin, { userId: agent.id, state: "FL", status: "ACTIVE" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("D) AGENT ve solo sus propias licencias", async () => {
    const admin = await makeActor("ADMIN");
    const agentA = await makeActor("AGENT");
    const agentB = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agentA.id, state: "OH", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    const ownList = await listAgentLicenses(agentA, agentA.id);
    expect(ownList.some((l) => l.id === license.id)).toBe(true);

    await expect(listAgentLicenses(agentB, agentA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("E) ASSISTANT no tiene acceso a licencias", async () => {
    const assistant = await makeActor("ASSISTANT");
    const agent = await makeActor("AGENT");
    await expect(listAgentLicenses(assistant, agent.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("F) ADMIN puede desactivar una licencia (ACTIVE -> INACTIVE)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "NJ", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    const updated = await updateAgentLicense(admin, license.id, { status: "INACTIVE" });
    expect(updated.status).toBe("INACTIVE");
  });

  it("G) crear una licencia audita AGENT_LICENSE_CREATE", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "GA", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    const events = await prisma.auditEvent.findMany({
      where: { entityId: license.id, action: "AGENT_LICENSE_CREATE" },
    });
    expect(events).toHaveLength(1);
  });
});
