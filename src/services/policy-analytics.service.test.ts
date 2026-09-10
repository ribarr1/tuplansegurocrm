import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPolicyAnalytics } from "@/services/policy-analytics.service";
import { createPolicy, cancelPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdHouseholdIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
      isAgent: role === "AGENT",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: { firstName: "Test", lastName: uniqueName("PolicyAnalyticsPerson"), contactStatus: "CLIENT", assignedAgentId },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeProduct(policyType: "HEALTH" | "LIFE" = "HEALTH") {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier PolicyAnalytics") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan PolicyAnalytics"), policyType },
  });
  createdProductIds.push(product.id);
  return { carrier, product };
}

async function makeHouseholdFor(personId: string, state: string) {
  const household = await prisma.household.create({ data: { state } });
  createdHouseholdIds.push(household.id);
  await prisma.householdMember.create({ data: { householdId: household.id, personId, role: "HEAD" } });
  return household;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-policy-analytics");
  agent = await makeActor("AGENT", "agent-policy-analytics");
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("policy-analytics.service (AMPLIACIÓN PREPRODUCCIÓN)", () => {
  it("cuenta el total y desglosa por estado sobre el universo filtrado", async () => {
    const holder = await makePerson();
    const { product } = await makeProduct("HEALTH");
    const active = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
    });
    createdPolicyIds.push(active.id);
    const pending = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
      status: "PENDING",
    });
    createdPolicyIds.push(pending.id);

    const result = await getPolicyAnalytics(admin, { carrierId: product.carrierId });
    expect(result.indicators.total).toBeGreaterThanOrEqual(2);
    const activeBucket = result.charts.byStatus.find((b) => b.status === "ACTIVE");
    const pendingBucket = result.charts.byStatus.find((b) => b.status === "PENDING");
    expect(activeBucket?.count).toBeGreaterThanOrEqual(1);
    expect(pendingBucket?.count).toBeGreaterThanOrEqual(1);
  });

  it("desglosa por tipo de póliza y por carrier cuando no se filtra por esa dimensión", async () => {
    const holder = await makePerson();
    const { product: healthProduct, carrier: healthCarrier } = await makeProduct("HEALTH");
    const { product: lifeProduct } = await makeProduct("LIFE");
    const p1 = await createPolicy(admin, { holderId: holder.id, productId: healthProduct.id, holderCovered: "false" });
    const p2 = await createPolicy(admin, { holderId: holder.id, productId: lifeProduct.id, holderCovered: "false" });
    createdPolicyIds.push(p1.id, p2.id);

    const result = await getPolicyAnalytics(admin, { carrierId: healthCarrier.id });
    // policyType SÍ se desglosa (no se filtró por tipo) — debe incluir
    // HEALTH, aunque el filtro de carrier ya haya limitado el universo.
    const healthBucket = result.charts.byType.find((b) => b.policyType === "HEALTH");
    expect(healthBucket?.count).toBeGreaterThanOrEqual(1);
    // byCarrier se omite: ya se filtró por un carrier específico.
    expect(result.charts.byCarrier).toEqual([]);
  });

  it("Propias vs referidas: desglosa por businessSource", async () => {
    const holder = await makePerson();
    const { product, carrier } = await makeProduct();
    const own = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    const referral = await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(own.id, referral.id);
    // businessSource se deriva automáticamente al crear (getPolicyEligibility,
    // requiere hogar + contratos de agente elegibles) — para esta
    // prueba de AGRUPACIÓN (no de derivación, ya cubierta en
    // policy-business-source.service.test.ts) se fija directamente.
    await prisma.policy.update({ where: { id: own.id }, data: { businessSource: "OWN" } });
    await prisma.policy.update({ where: { id: referral.id }, data: { businessSource: "REFERRAL" } });

    const result = await getPolicyAnalytics(admin, { carrierId: carrier.id });
    const ownBucket = result.charts.byBusinessSource.find((b) => b.businessSource === "OWN");
    const referralBucket = result.charts.byBusinessSource.find((b) => b.businessSource === "REFERRAL");
    expect(ownBucket?.count).toBeGreaterThanOrEqual(1);
    expect(referralBucket?.count).toBeGreaterThanOrEqual(1);
  });

  it("estado geográfico: agrupa vía Household.state, y las pólizas sin hogar caen en 'Sin estado'", async () => {
    const holderWithState = await makePerson();
    await makeHouseholdFor(holderWithState.id, "FL");
    const holderNoHousehold = await makePerson();
    const { product, carrier } = await makeProduct();

    const withState = await createPolicy(admin, { holderId: holderWithState.id, productId: product.id, holderCovered: "false" });
    const withoutState = await createPolicy(admin, { holderId: holderNoHousehold.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(withState.id, withoutState.id);

    const result = await getPolicyAnalytics(admin, { carrierId: carrier.id });
    const flBucket = result.charts.byGeographicState.find((b) => b.state === "FL");
    const noStateBucket = result.charts.byGeographicState.find((b) => b.state === null);
    expect(flBucket?.count).toBeGreaterThanOrEqual(1);
    expect(noStateBucket?.count).toBeGreaterThanOrEqual(1);
  });

  it("terminaciones/cancelaciones: cancelPolicy alimenta el desglose mensual de cancelaciones vía terminationDate", async () => {
    const holder = await makePerson();
    const { product, carrier } = await makeProduct();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: product.id,
      holderCovered: "false",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
    });
    createdPolicyIds.push(policy.id);
    const today = new Date();
    await cancelPolicy(admin, policy.id, { terminationDate: today });

    const result = await getPolicyAnalytics(admin, { carrierId: carrier.id, periodMode: "YEAR", year: today.getUTCFullYear() });
    const totalCancelaciones = result.charts.monthlyAltasCancelaciones.reduce((sum, m) => sum + m.cancelaciones, 0);
    expect(totalCancelaciones).toBeGreaterThanOrEqual(1);
  });

  it("AGENT solo ve pólizas dentro de su alcance (policyAgentAccessWhere)", async () => {
    const otherAgent = await makeActor("AGENT", "other-agent-policy-analytics");
    const holderOfOther = await makePerson(otherAgent.id);
    const { product, carrier } = await makeProduct();
    const policy = await createPolicy(admin, { holderId: holderOfOther.id, productId: product.id, holderCovered: "false" });
    createdPolicyIds.push(policy.id);

    const resultAsAgent = await getPolicyAnalytics(agent, { carrierId: carrier.id });
    expect(resultAsAgent.indicators.total).toBe(0);

    const resultAsAdmin = await getPolicyAnalytics(admin, { carrierId: carrier.id });
    expect(resultAsAdmin.indicators.total).toBeGreaterThanOrEqual(1);
  });
});
