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
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
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

  // CORRECCIÓN (editar licencias) — nuevas pruebas.
  it("H) ADMIN edita número de licencia, fecha efectiva y fecha de vencimiento", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, {
      userId: agent.id, state: "NC", status: "ACTIVE",
      licenseNumber: "OLD-123", effectiveDate: "2025-01-01", expirationDate: "2025-12-31",
    });
    createdLicenseIds.push(license.id);

    const updated = await updateAgentLicense(admin, license.id, {
      licenseNumber: "NEW-456", effectiveDate: "2026-01-01", expirationDate: "2026-12-31",
    });
    expect(updated.licenseNumber).toBe("NEW-456");
    expect(updated.effectiveDate?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(updated.expirationDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(updated.state).toBe("NC"); // nunca cambia el estado geográfico
  });

  it("I) AGENT no puede editar licencias (FORBIDDEN), incluso las propias", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "SC", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    await expect(
      updateAgentLicense(agent, license.id, { licenseNumber: "HACKED-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("J) ASSISTANT no puede editar licencias (FORBIDDEN)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const assistant = await makeActor("ASSISTANT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "VA", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    await expect(
      updateAgentLicense(assistant, license.id, { licenseNumber: "HACKED-2" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("K) rechaza expirationDate anterior a effectiveDate al EDITAR (comparando contra el valor existente cuando solo se cambia una fecha)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, {
      userId: agent.id, state: "AZ", status: "ACTIVE", effectiveDate: "2026-06-01",
    });
    createdLicenseIds.push(license.id);

    // Solo se envía expirationDate — debe compararse contra el
    // effectiveDate YA GUARDADO (2026-06-01), no asumir que no hay
    // restricción porque effectiveDate no vino en esta llamada.
    await expect(
      updateAgentLicense(admin, license.id, { expirationDate: "2026-01-01" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("L) rechaza expirationDate anterior a effectiveDate al CREAR", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    await expect(
      createAgentLicense(admin, {
        userId: agent.id, state: "NM", status: "ACTIVE",
        effectiveDate: "2026-06-01", expirationDate: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("M) editar una licencia audita AGENT_LICENSE_UPDATE con los campos modificados", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, {
      userId: agent.id, state: "WA", status: "ACTIVE", licenseNumber: "AUDIT-OLD",
    });
    createdLicenseIds.push(license.id);

    await updateAgentLicense(admin, license.id, { licenseNumber: "AUDIT-NEW" });

    const events = await prisma.auditEvent.findMany({
      where: { entityId: license.id, action: "AGENT_LICENSE_UPDATE" },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].changes)).toContain("AUDIT-NEW");
  });

  it("N) no modificar ningún campo no crea un evento de auditoría (sin cambio real)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const license = await createAgentLicense(admin, { userId: agent.id, state: "OR", status: "ACTIVE" });
    createdLicenseIds.push(license.id);

    await updateAgentLicense(admin, license.id, {});
    const events = await prisma.auditEvent.findMany({
      where: { entityId: license.id, action: "AGENT_LICENSE_UPDATE" },
    });
    expect(events).toHaveLength(0);
  });
});
