import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createCommissionRule,
  generateExpectationForPeriod,
  computeExpectedAmount,
} from "@/services/commission-rules.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdRuleIds: string[] = [];
const createdExpectationIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT", label: string): Promise<AuthorizedUser> {
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

async function makePerson() {
  const person = await prisma.person.create({
    data: { firstName: "Test", lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`, contactStatus: "CLIENT" },
  });
  createdPersonIds.push(person.id);
  return person;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let carrierId: string;
let productId: string;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-crules");
  agent = await makeActor("AGENT", "agent-crules");
  const carrier = await prisma.carrier.create({ data: { name: `Carrier Rules ${Date.now()}` } });
  carrierId = carrier.id;
  createdCarrierIds.push(carrierId);
  const product = await prisma.product.create({
    data: { carrierId, name: "Plan Rules Test", policyType: "HEALTH" },
  });
  productId = product.id;
  createdProductIds.push(productId);
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({ where: { commissionExpectationId: { in: createdExpectationIds } } });
  await prisma.commissionExpectation.deleteMany({ where: { id: { in: createdExpectationIds } } });
  await prisma.commissionRule.deleteMany({ where: { id: { in: createdRuleIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

async function makePolicy(overrides: Record<string, unknown> = {}) {
  const holder = await makePerson();
  const policy = await createPolicy(admin, {
    holderId: holder.id,
    productId,
    holderCovered: "true",
    effectiveDate: new Date("2026-01-15"),
    premiumAmount: "500.00",
    ...overrides,
  });
  createdPolicyIds.push(policy.id);
  return policy;
}

describe("commission-rules.service", () => {
  it("AB) regla FIXED_AMOUNT mensual genera el monto correcto", async () => {
    const policy = await makePolicy();
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    const result = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-01" });
    expect(result.status).toBe("CREATED");
    if (result.status === "CREATED") createdExpectationIds.push(result.expectationId);

    const exp = await prisma.commissionExpectation.findUnique({ where: { id: (result as { expectationId: string }).expectationId } });
    expect(exp?.expectedAmount.toString()).toBe("25");
  });

  it("AC) regla PERCENTAGE de prima anualizada calcula correctamente", async () => {
    const policy = await makePolicy({ premiumAmount: "100.00" });
    const rule = await createCommissionRule(admin, {
      productId,
      method: "PERCENTAGE",
      base: "PREMIUM_ANNUALIZED",
      initialPercentage: "80.00",
      initialPeriodicity: "ONE_TIME",
    });
    createdRuleIds.push(rule.id);

    const result = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-01" });
    expect(result.status).toBe("CREATED");
    if (result.status === "CREATED") {
      createdExpectationIds.push(result.expectationId);
      const exp = await prisma.commissionExpectation.findUnique({ where: { id: result.expectationId } });
      // 100 * 12 * 0.80 = 960
      expect(exp?.expectedAmount.toString()).toBe("960");
    }
  });

  it("AD) regla PER_MEMBER multiplica por miembros cubiertos reales (no holder no cubierto, no household)", async () => {
    const spouse = await makePerson();
    const holder = await makePerson();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId,
      holderCovered: "false", // holder NO cubierto -> no cuenta
      coveredMembers: [{ personId: spouse.id, role: "SPOUSE" }],
      effectiveDate: new Date("2026-01-15"),
    });
    createdPolicyIds.push(policy.id);

    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "PER_MEMBER",
      initialAmount: "10.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    const result = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-01" });
    expect(result.status).toBe("CREATED");
    if (result.status === "CREATED") {
      createdExpectationIds.push(result.expectationId);
      const exp = await prisma.commissionExpectation.findUnique({ where: { id: result.expectationId } });
      // Solo 1 miembro cubierto (spouse) -> 10.00, no 20.00
      expect(exp?.expectedAmount.toString()).toBe("10");
    }
  });

  it("AE) residual solo aplica desde residualStartYear", () => {
    const rule = {
      method: "PERCENTAGE" as const,
      base: "PREMIUM_MONTHLY" as const,
      initialAmount: null,
      initialPercentage: "80.00",
      initialPeriodicity: "ANNUAL" as const,
      residualEnabled: true,
      residualAmount: null,
      residualPercentage: "4.00",
      residualPeriodicity: "ANNUAL" as const,
      residualStartYear: 2,
    };
    const policy = { premiumAmount: "100.00", effectiveDate: new Date(Date.UTC(2026, 0, 1)) };

    // Año 1 (mes 0) -> usa initial (80%)
    const year1 = computeExpectedAmount(rule, policy, 0, new Date(Date.UTC(2026, 0, 1)));
    expect("amount" in year1 && year1.amount.toString()).toBe("80");

    // Año 2 (mes 12) -> usa residual (4%)
    const year2 = computeExpectedAmount(rule, policy, 0, new Date(Date.UTC(2027, 0, 1)));
    expect("amount" in year2 && year2.amount.toString()).toBe("4");
  });

  it("AF) generar dos veces para el mismo período es idempotente (no duplica)", async () => {
    const policy = await makePolicy();
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "15.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    const first = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-02" });
    expect(first.status).toBe("CREATED");
    if (first.status === "CREATED") createdExpectationIds.push(first.expectationId);

    const second = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-02" });
    expect(second.status).toBe("ALREADY_EXISTS");

    const count = await prisma.commissionExpectation.count({ where: { policyId: policy.id, period: new Date("2026-02-01") } });
    expect(count).toBe(1);
  });

  it("AG) cambiar la regla no altera expectativas ya generadas", async () => {
    const policy = await makePolicy();
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "50.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    const gen = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-03" });
    expect(gen.status).toBe("CREATED");
    if (gen.status === "CREATED") createdExpectationIds.push(gen.expectationId);

    // Nueva regla con otro monto — no debe tocar la expectativa de marzo ya creada.
    const newRule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "999.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(newRule.id);

    const exp = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: policy.id, period: new Date("2026-03-01") } },
    });
    expect(exp?.expectedAmount.toString()).toBe("50");
  });

  it("solo ADMIN puede crear reglas o generar expectativas", async () => {
    await expect(
      createCommissionRule(agent, {
        productId,
        method: "FIXED_AMOUNT",
        base: "FIXED",
        initialAmount: "10.00",
        initialPeriodicity: "MONTHLY",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const policy = await makePolicy();
    await expect(
      generateExpectationForPeriod(agent, { policyId: policy.id, period: "2026-01" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sin regla activa -> NO_RULE, no crea nada", async () => {
    const otherProduct = await prisma.product.create({
      data: { carrierId, name: "Plan Sin Regla", policyType: "HEALTH" },
    });
    createdProductIds.push(otherProduct.id);
    const holder = await makePerson();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: otherProduct.id,
      holderCovered: "true",
      effectiveDate: new Date("2026-01-15"),
    });
    createdPolicyIds.push(policy.id);

    const result = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-01" });
    expect(result.status).toBe("NO_RULE");
  });
});
