import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getHealthPolicyDetail,
  createHealthPolicyDetail,
  updateHealthPolicyDetail,
} from "@/services/health-policies.service";
import { createPolicy, getPolicyById, listPolicies, getPoliciesForPerson } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPolicyIds: string[] = [];

function trackCarrier<T extends { id: string }>(c: T): T {
  createdCarrierIds.push(c.id);
  return c;
}
function trackProduct<T extends { id: string }>(p: T): T {
  createdProductIds.push(p.id);
  return p;
}
function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}
function trackPolicy<T extends { id: string }>(p: T): T {
  createdPolicyIds.push(p.id);
  return p;
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
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

async function makeCarrier() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Health") } });
  return trackCarrier(carrier);
}

async function makeProduct(policyType: "HEALTH" | "LIFE" | "DENTAL") {
  const carrier = await makeCarrier();
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName(`Plan ${policyType}`), policyType },
  });
  return trackProduct(product);
}

async function makeHealthPolicy(actor: AuthorizedUser, holder: { id: string }) {
  const product = await makeProduct("HEALTH");
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
  });
  return trackPolicy(policy);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-hp");
  agent = await makeActor("AGENT", "agent-hp");
  agentB = await makeActor("AGENT", "agentb-hp");
  assistant = await makeActor("ASSISTANT", "assistant-hp");
});

afterAll(async () => {
  await prisma.healthPolicyDetail.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("health-policies.service", () => {
  it("A) crear detail para HEALTH funciona", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, { policyId: policy.id });
    expect(detail.policyId).toBe(policy.id);
  });

  it("B) crear detail para LIFE falla", async () => {
    const holder = await makePerson();
    const product = await makeProduct("LIFE");
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );
    await expect(createHealthPolicyDetail(admin, { policyId: policy.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("C) crear detail para DENTAL falla", async () => {
    const holder = await makePerson();
    const product = await makeProduct("DENTAL");
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );
    await expect(createHealthPolicyDetail(admin, { policyId: policy.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("D) segunda creación para la misma Policy falla con CONFLICT", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id });
    await expect(createHealthPolicyDetail(admin, { policyId: policy.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("E) marketplaceState normaliza il -> IL", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      marketplaceState: "il",
    });
    expect(detail.marketplaceState).toBe("IL");
  });

  it("F) state inválido falla", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await expect(
      createHealthPolicyDetail(admin, { policyId: policy.id, marketplaceState: "ILL" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("G) Application ID alfanumérico funciona", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      marketplaceApplicationId: "AB-2026-00931X",
    });
    expect(detail.marketplaceApplicationId).toBe("AB-2026-00931X");
  });

  it("H) blank decimal -> null", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      taxCreditAmount: "",
    });
    expect("taxCreditAmount" in detail && detail.taxCreditAmount).toBeNull();
  });

  it("I) decimal válido se conserva correctamente", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      deductibleIndividual: "1500.50",
    });
    expect(detail.deductibleIndividual?.toString()).toBe("1500.5");
  });

  it("J) monto negativo falla", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await expect(
      createHealthPolicyDetail(admin, { policyId: policy.id, incomeUsed: "-100" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("K) planNameSnapshot puede diferir de Product.name", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      planNameSnapshot: "Nombre distinto al del producto",
    });
    expect(detail.planNameSnapshot).toBe("Nombre distinto al del producto");
  });

  it("L) cambiar Product.name no cambia el snapshot existente", async () => {
    const holder = await makePerson();
    const product = await makeProduct("HEALTH");
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );
    const detail = await createHealthPolicyDetail(admin, {
      policyId: policy.id,
      planNameSnapshot: product.name,
    });
    await prisma.product.update({ where: { id: product.id }, data: { name: uniqueName("Nuevo nombre") } });
    const fetched = await getHealthPolicyDetail(admin, policy.id);
    expect(fetched?.planNameSnapshot).toBe(detail.planNameSnapshot);
  });

  it("M) ADMIN ve campos financieros", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, incomeUsed: "45000" });
    const fetched = await getHealthPolicyDetail(admin, policy.id);
    expect(fetched && "incomeUsed" in fetched ? fetched.incomeUsed?.toString() : undefined).toBe("45000");
  });

  it("N) AGENT autorizado ve campos financieros", async () => {
    const holder = await makePerson(agent.id);
    const policy = await makeHealthPolicy(agent, holder);
    await createHealthPolicyDetail(agent, { policyId: policy.id, incomeUsed: "30000" });
    const fetched = await getHealthPolicyDetail(agent, policy.id);
    expect(fetched && "incomeUsed" in fetched ? fetched.incomeUsed?.toString() : undefined).toBe("30000");
  });

  it("O) AGENT no autorizado recibe FORBIDDEN", async () => {
    const holder = await makePerson(agentB.id);
    const policy = await makeHealthPolicy(agentB, holder);
    await expect(getHealthPolicyDetail(agent, policy.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P) ASSISTANT no recibe incomeUsed", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, incomeUsed: "20000" });
    const fetched = await getHealthPolicyDetail(assistant, policy.id);
    expect(fetched).not.toBeNull();
    expect(fetched && "incomeUsed" in fetched).toBe(false);
  });

  it("Q) ASSISTANT no recibe taxCreditAmount", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, taxCreditAmount: "5000" });
    const fetched = await getHealthPolicyDetail(assistant, policy.id);
    expect(fetched).not.toBeNull();
    expect(fetched && "taxCreditAmount" in fetched).toBe(false);
  });

  it("R) ASSISTANT no puede modificar campos restringidos", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id });
    await expect(
      updateHealthPolicyDetail(assistant, policy.id, { incomeUsed: "10000" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateHealthPolicyDetail(assistant, policy.id, { taxCreditAmount: "10000" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("S) ASSISTANT puede modificar campos permitidos", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id });
    const updated = await updateHealthPolicyDetail(assistant, policy.id, {
      marketplaceState: "TX",
      deductibleFamily: "3000",
    });
    expect(updated.marketplaceState).toBe("TX");
  });

  // T) "usuario inactive bloqueado": misma razón documentada en los
  // servicios anteriores — cada función recibe un actor ya resuelto
  // por requireSessionUser()/requireSessionRole(), que ya rechaza
  // usuarios inactivos (probado en src/lib/authorization.test.ts).

  it("U) listPolicies sigue sin traer HealthPolicyDetail", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, incomeUsed: "1" });
    const { items } = await listPolicies(admin, { search: undefined });
    const found = items.find((p) => p.id === policy.id);
    expect(found).toBeDefined();
    expect(found && Object.keys(found)).not.toContain("healthDetail");

    const forPerson = await getPoliciesForPerson(admin, holder.id);
    const foundForPerson = forPerson.find((p) => p.id === policy.id);
    expect(foundForPerson && Object.keys(foundForPerson)).not.toContain("healthDetail");
  });

  it("V) getPolicyById básico sigue sin traer datos sensibles Health", async () => {
    const holder = await makePerson();
    const policy = await makeHealthPolicy(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, incomeUsed: "1" });
    const fetched = await getPolicyById(admin, policy.id);
    expect(Object.keys(fetched)).not.toContain("healthDetail");
  });
});
