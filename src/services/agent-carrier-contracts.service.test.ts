import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listAgentCarrierContracts,
  createAgentCarrierContract,
  updateAgentCarrierContract,
} from "@/services/agent-carrier-contracts.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdContractIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${role} Contract Test`,
      email: `${role.toLowerCase()}.ctr.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function makeCarrier() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Contract") } });
  createdCarrierIds.push(carrier.id);
  return carrier;
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdContractIds } } });
  await prisma.agentCarrierContract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("agent-carrier-contracts.service", () => {
  it("A) crea una fila por cada estado seleccionado (nunca un array opaco)", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const carrier = await makeCarrier();

    const created = await createAgentCarrierContract(admin, {
      userId: agent.id,
      carrierId: carrier.id,
      policyType: "HEALTH",
      states: ["IL", "TX", "FL"],
      status: "ACTIVE",
    });
    created.forEach((c) => createdContractIds.push(c.id));
    expect(created).toHaveLength(3);
    expect(new Set(created.map((c) => c.state))).toEqual(new Set(["IL", "TX", "FL"]));
  });

  it("B) rechaza duplicar (carrier, estado, policyType) para el mismo agente", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const carrier = await makeCarrier();

    const first = await createAgentCarrierContract(admin, {
      userId: agent.id,
      carrierId: carrier.id,
      policyType: "HEALTH",
      states: ["IL"],
      status: "ACTIVE",
    });
    first.forEach((c) => createdContractIds.push(c.id));

    await expect(
      createAgentCarrierContract(admin, {
        userId: agent.id,
        carrierId: carrier.id,
        policyType: "HEALTH",
        states: ["IL"],
        status: "ACTIVE",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("C) un contrato HEALTH no implica un contrato DENTAL con el mismo carrier", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const carrier = await makeCarrier();

    const health = await createAgentCarrierContract(admin, {
      userId: agent.id,
      carrierId: carrier.id,
      policyType: "HEALTH",
      states: ["IL"],
      status: "ACTIVE",
    });
    health.forEach((c) => createdContractIds.push(c.id));

    // No debe fallar por conflicto — es una fila legítimamente distinta.
    const dental = await createAgentCarrierContract(admin, {
      userId: agent.id,
      carrierId: carrier.id,
      policyType: "DENTAL",
      states: ["IL"],
      status: "ACTIVE",
    });
    dental.forEach((c) => createdContractIds.push(c.id));
    expect(dental).toHaveLength(1);
  });

  it("D) AGENT ve solo sus propios contratos", async () => {
    const admin = await makeActor("ADMIN");
    const agentA = await makeActor("AGENT");
    const agentB = await makeActor("AGENT");
    const carrier = await makeCarrier();

    const created = await createAgentCarrierContract(admin, {
      userId: agentA.id,
      carrierId: carrier.id,
      policyType: "HEALTH",
      states: ["OH"],
      status: "ACTIVE",
    });
    created.forEach((c) => createdContractIds.push(c.id));

    const own = await listAgentCarrierContracts(agentA, agentA.id);
    expect(own.some((c) => c.id === created[0].id)).toBe(true);
    await expect(listAgentCarrierContracts(agentB, agentA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("E) ADMIN puede desactivar un contrato individual", async () => {
    const admin = await makeActor("ADMIN");
    const agent = await makeActor("AGENT");
    const carrier = await makeCarrier();

    const created = await createAgentCarrierContract(admin, {
      userId: agent.id,
      carrierId: carrier.id,
      policyType: "HEALTH",
      states: ["GA"],
      status: "ACTIVE",
    });
    created.forEach((c) => createdContractIds.push(c.id));

    const updated = await updateAgentCarrierContract(admin, created[0].id, { status: "INACTIVE" });
    expect(updated.status).toBe("INACTIVE");
  });
});
