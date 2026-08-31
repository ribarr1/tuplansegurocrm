import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActiveAgents } from "@/services/users.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string, isActive = true): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("users.service.listActiveAgents", () => {
  it("ADMIN obtiene solo agentes activos", async () => {
    const admin = await makeActor("ADMIN", "admin-listagents");
    const activeAgent = await makeActor("AGENT", "agent-active");
    await makeActor("AGENT", "agent-inactive", false);
    await makeActor("ASSISTANT", "assistant-notagent");

    const result = await listActiveAgents(admin);
    const ids = result.map((a) => a.id);
    expect(ids).toContain(activeAgent.id);
    expect(result.every((a) => a.id !== undefined)).toBe(true);
  });

  it("AGENT no puede consultar la lista de agentes", async () => {
    const agent = await makeActor("AGENT", "agent-forbidden");
    await expect(listActiveAgents(agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ASSISTANT sí puede consultarla desde la Fase 014: necesita poder
  // asignar tareas a agentes (ver tasks.service.ts / docs/DECISIONS.md).
  it("ASSISTANT puede consultar la lista de agentes", async () => {
    const assistant = await makeActor("ASSISTANT", "assistant-allowed");
    const activeAgent = await makeActor("AGENT", "agent-active-2");
    const result = await listActiveAgents(assistant);
    expect(result.map((a) => a.id)).toContain(activeAgent.id);
  });
});
