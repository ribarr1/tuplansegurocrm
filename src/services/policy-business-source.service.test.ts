import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPolicy, renewPolicy, updatePolicy } from "@/services/policies.service";
import { computeEligibleAgentIdsByProduct } from "@/services/policy-business-source.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 025 (Parte I) — Propia (OWN) vs Referida (REFERRAL).

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdHouseholdIds: string[] = [];
const createdLicenseIds: string[] = [];
const createdContractIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" = "ADMIN"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `Admin BusinessSource`,
      email: `admin.bs.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makeAgentUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: {
      name: "Agent BusinessSource",
      email: `agent.bs.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role: "AGENT",
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeHolderWithHousehold(state: string | null) {
  const person = await prisma.person.create({
    data: { firstName: "BS", lastName: `Holder${Date.now()}${Math.random().toString(36).slice(2)}`, contactStatus: "PROSPECT" },
  });
  createdPersonIds.push(person.id);
  const household = await prisma.household.create({ data: { state } });
  createdHouseholdIds.push(household.id);
  await prisma.householdMember.create({ data: { householdId: household.id, personId: person.id, role: "HEAD" } });
  return person;
}

async function makeProduct() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier BS") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan BS"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  return { carrier, product };
}

async function grantLicenseAndContract(userId: string, state: string, carrierId: string) {
  const license = await prisma.agentLicense.create({ data: { userId, state, status: "ACTIVE" } });
  createdLicenseIds.push(license.id);
  const contract = await prisma.agentCarrierContract.create({
    data: { userId, carrierId, state, policyType: "HEALTH", status: "ACTIVE" },
  });
  createdContractIds.push(contract.id);
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.agentCarrierContract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.agentLicense.deleteMany({ where: { id: { in: createdLicenseIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("policy-business-source (createPolicy businessSource wiring)", () => {
  it("A) un agente con licencia+contrato activos en el estado/carrier de la póliza -> OWN", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agent.id, "IL", carrier.id);

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("OWN");
  });

  it("B) ningún agente calificado en ese estado/carrier -> REFERRAL", async () => {
    const admin = await makeActor();
    const holder = await makeHolderWithHousehold("OH");
    const { product } = await makeProduct();

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("C) household sin state -> UNKNOWN (nunca se adivina)", async () => {
    const admin = await makeActor();
    const holder = await makeHolderWithHousehold(null);
    const { product } = await makeProduct();

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("UNKNOWN");
  });

  it("D) licencia sin contrato para ese carrier -> REFERRAL (una licencia sola no basta)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("TX");
    const { product } = await makeProduct();
    const license = await prisma.agentLicense.create({ data: { userId: agent.id, state: "TX", status: "ACTIVE" } });
    createdLicenseIds.push(license.id);
    // Sin AgentCarrierContract para este carrier — solo la licencia.

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("E) contrato sin licencia activa en ese estado -> REFERRAL", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("GA");
    const { carrier, product } = await makeProduct();
    const contract = await prisma.agentCarrierContract.create({
      data: { userId: agent.id, carrierId: carrier.id, state: "GA", policyType: "HEALTH", status: "ACTIVE" },
    });
    createdContractIds.push(contract.id);
    // Sin AgentLicense para GA.

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("F) OWN pertenece a la agencia — basta con que UN agente distinto al asignado califique", async () => {
    const admin = await makeActor();
    const qualifiedAgent = await makeAgentUser();
    const unrelatedAgent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("SC");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(qualifiedAgent.id, "SC", carrier.id);
    // unrelatedAgent no tiene ni licencia ni contrato — igual la
    // póliza es OWN porque OTRO agente de la agencia sí califica.
    void unrelatedAgent;

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("OWN");
  });
});

// ---------------------------------------------------------------------------
// Fase 025.3 (Bloque A) — restricción del selector de agente por
// elegibilidad (AgentLicense + AgentCarrierContract), y protección
// server-side de processedById para pólizas OWN.
// ---------------------------------------------------------------------------
describe("policy-business-source — elegibilidad de agente para OWN (Fase 025.3, Bloque A)", () => {
  it("G) contrato para un carrier DISTINTO al de la póliza -> no elegible (REFERRAL)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { product } = await makeProduct();
    const otherCarrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier BS otro") } });
    createdCarrierIds.push(otherCarrier.id);
    await grantLicenseAndContract(agent.id, "IL", otherCarrier.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("H) contrato/licencia para un estado DISTINTO al de la póliza -> no elegible (REFERRAL)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agent.id, "OH", carrier.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("I) contrato para un policyType DISTINTO al de la póliza -> no elegible (REFERRAL)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    const license = await prisma.agentLicense.create({ data: { userId: agent.id, state: "IL", status: "ACTIVE" } });
    createdLicenseIds.push(license.id);
    const contract = await prisma.agentCarrierContract.create({
      data: { userId: agent.id, carrierId: carrier.id, state: "IL", policyType: "DENTAL", status: "ACTIVE" },
    });
    createdContractIds.push(contract.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("J) licencia INACTIVE -> no elegible (REFERRAL)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    const license = await prisma.agentLicense.create({ data: { userId: agent.id, state: "IL", status: "INACTIVE" } });
    createdLicenseIds.push(license.id);
    const contract = await prisma.agentCarrierContract.create({
      data: { userId: agent.id, carrierId: carrier.id, state: "IL", policyType: "HEALTH", status: "ACTIVE" },
    });
    createdContractIds.push(contract.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("K) contrato INACTIVE -> no elegible (REFERRAL)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    const license = await prisma.agentLicense.create({ data: { userId: agent.id, state: "IL", status: "ACTIVE" } });
    createdLicenseIds.push(license.id);
    const contract = await prisma.agentCarrierContract.create({
      data: { userId: agent.id, carrierId: carrier.id, state: "IL", policyType: "HEALTH", status: "INACTIVE" },
    });
    createdContractIds.push(contract.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("REFERRAL");
  });

  it("L) un único agente elegible -> se preselecciona automáticamente (ADMIN no pide a nadie en particular)", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agent.id, "IL", carrier.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("OWN");
    expect(policy.processedBy?.id).toBe(agent.id);
  });

  it("M) varios agentes elegibles y ADMIN no elige ninguno -> se rechaza (nunca se adivina cuál)", async () => {
    const admin = await makeActor();
    const agentOne = await makeAgentUser();
    const agentTwo = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agentOne.id, "IL", carrier.id);
    await grantLicenseAndContract(agentTwo.id, "IL", carrier.id);

    await expect(
      createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("M2) varios agentes elegibles y ADMIN elige explícitamente uno de ellos -> OWN con ese agente", async () => {
    const admin = await makeActor();
    const agentOne = await makeAgentUser();
    const agentTwo = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agentOne.id, "IL", carrier.id);
    await grantLicenseAndContract(agentTwo.id, "IL", carrier.id);

    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
      processedById: agentTwo.id,
    });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("OWN");
    expect(policy.processedBy?.id).toBe(agentTwo.id);
  });

  it("N) server-side rechaza un agente explícito NO elegible para una póliza OWN", async () => {
    const admin = await makeActor();
    const eligibleAgent = await makeAgentUser();
    const ineligibleAgent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(eligibleAgent.id, "IL", carrier.id);

    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: product.id,
        holderCovered: "false",
        processedById: ineligibleAgent.id,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("O) updatePolicy NUNCA recalcula businessSource histórico, ni revalida elegibilidad por cambios no relacionados", async () => {
    const admin = await makeActor();
    const agent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agent.id, "IL", carrier.id);

    const policy = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);
    expect(policy.businessSource).toBe("OWN");

    // El contrato del agente se desactiva DESPUÉS — la póliza ya
    // creada nunca debe reclasificarse ni bloquearse por ediciones que
    // no tocan processedById/productId.
    await prisma.agentCarrierContract.updateMany({ where: { userId: agent.id }, data: { status: "INACTIVE" } });

    const updated = await updatePolicy(admin, policy.id, { premiumAmount: "199.99" });
    expect(updated.businessSource).toBe("OWN");
    expect(updated.processedBy?.id).toBe(agent.id);
  });

  it("P) AGENT sin elegibilidad no puede crear/procesar por sí mismo una póliza que resultaría OWN de otro agente", async () => {
    const eligibleAgentUser = await makeAgentUser();
    const ineligibleAgentUser = await makeAgentUser();
    const ineligibleAgentActor: AuthorizedUser = {
      id: ineligibleAgentUser.id,
      name: "Agent BusinessSource",
      email: `agent.actor.${Date.now()}@test.local`,
      twoFactorEnabled: true,
      role: "AGENT",
      isActive: true,
    };
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(eligibleAgentUser.id, "IL", carrier.id);

    await expect(
      createPolicy(ineligibleAgentActor, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Q) renewPolicy recalcula elegibilidad de nuevo, nunca hereda processedById de la predecesora", async () => {
    const admin = await makeActor();
    const oldAgent = await makeAgentUser();
    const newAgent = await makeAgentUser();
    const holder = await makeHolderWithHousehold("IL");
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(oldAgent.id, "IL", carrier.id);

    const original = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(original.id);
    expect(original.processedBy?.id).toBe(oldAgent.id);

    // Nuevo producto/carrier para la renovación — solo newAgent
    // califica ahí, oldAgent ya no.
    const { carrier: newCarrier, product: newProduct } = await makeProduct();
    await grantLicenseAndContract(newAgent.id, "IL", newCarrier.id);

    const renewed = await renewPolicy(admin, original.id, {
      productId: newProduct.id,
      holderCovered: "false",
    });
    createdPolicyIds.push(renewed.id);
    expect(renewed.businessSource).toBe("OWN");
    expect(renewed.processedBy?.id).toBe(newAgent.id);
  });

  it("R) computeEligibleAgentIdsByProduct devuelve exactamente los ids elegibles por producto, mapa vacío sin state", async () => {
    const agent = await makeAgentUser();
    const { carrier, product } = await makeProduct();
    await grantLicenseAndContract(agent.id, "IL", carrier.id);

    const withState = await computeEligibleAgentIdsByProduct("IL", [
      { id: product.id, policyType: "HEALTH", carrier: { id: carrier.id } },
    ]);
    expect(withState[product.id]).toEqual([agent.id]);

    const withoutState = await computeEligibleAgentIdsByProduct(null, [
      { id: product.id, policyType: "HEALTH", carrier: { id: carrier.id } },
    ]);
    expect(withoutState).toEqual({});
  });
});
