import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createCommissionRule,
  generateExpectationForPeriod,
  computeExpectedAmount,
  autoGenerateCurrentPeriodExpectation,
  listCommissionRulesForProduct,
} from "@/services/commission-rules.service";
import { createPolicy, addPolicyMember } from "@/services/policies.service";
import { getTodayBusinessRange } from "@/lib/business-time";
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

  // -------------------------------------------------------------------
  // Generación automática — Fase 019.7 (hallazgo #14 de UAT):
  // CommissionRule debe ser la base real de CommissionExpectation, no
  // solo informativa.
  // -------------------------------------------------------------------

  it("H) autoGenerateCurrentPeriodExpectation genera la expectativa del mes de negocio actual cuando la póliza está ACTIVE", async () => {
    const holder = await makePerson();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-15"),
    });
    createdPolicyIds.push(policy.id);
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    await autoGenerateCurrentPeriodExpectation(policy.id);

    const { year, month } = getTodayBusinessRange();
    const currentPeriod = new Date(Date.UTC(year, month - 1, 1));
    const created = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: policy.id, period: currentPeriod } },
    });
    expect(created).not.toBeNull();
    expect(created?.expectedAmount.toString()).toBe("25");
    expect(created?.calculatedAmount?.toString()).toBe("25");
    expect(created?.generatedByRuleId).toBe(rule.id);
    if (created) createdExpectationIds.push(created.id);
  });

  it("autoGenerateCurrentPeriodExpectation NO genera nada si la póliza no está ACTIVE (ej. PENDING)", async () => {
    const holder = await makePerson();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId,
      holderCovered: "true",
      status: "PENDING",
      effectiveDate: new Date("2026-01-15"),
    });
    createdPolicyIds.push(policy.id);
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    await autoGenerateCurrentPeriodExpectation(policy.id);

    const { year, month } = getTodayBusinessRange();
    const currentPeriod = new Date(Date.UTC(year, month - 1, 1));
    const created = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: policy.id, period: currentPeriod } },
    });
    expect(created).toBeNull();
  });

  it("autoGenerateCurrentPeriodExpectation nunca lanza (best effort) aunque la póliza no exista", async () => {
    await expect(autoGenerateCurrentPeriodExpectation("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("P) agregar un PolicyMember bajo una regla PER_MEMBER afecta períodos futuros, nunca el ya generado", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-15"),
    });
    createdPolicyIds.push(policy.id);
    const rule = await createCommissionRule(admin, {
      productId,
      method: "FIXED_AMOUNT",
      base: "PER_MEMBER",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    createdRuleIds.push(rule.id);

    // Mes actual: solo el titular cubierto (1 miembro) -> $25.
    await autoGenerateCurrentPeriodExpectation(policy.id);
    const { year, month } = getTodayBusinessRange();
    const currentPeriod = new Date(Date.UTC(year, month - 1, 1));
    const currentExp = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: policy.id, period: currentPeriod } },
    });
    expect(currentExp?.expectedAmount.toString()).toBe("25");
    if (currentExp) createdExpectationIds.push(currentExp.id);

    // Se agrega un cónyuge cubierto a la póliza — el mes ya generado NO cambia.
    await addPolicyMember(admin, policy.id, { personId: spouse.id, role: "SPOUSE" });
    const stillCurrentExp = await prisma.commissionExpectation.findUnique({
      where: { policyId_period: { policyId: policy.id, period: currentPeriod } },
    });
    expect(stillCurrentExp?.expectedAmount.toString()).toBe("25");

    // Un período futuro, generado explícitamente después de agregar el
    // miembro, sí refleja el nuevo conteo (2 miembros -> $50).
    const nextMonth = new Date(Date.UTC(year, month, 1)); // mes siguiente
    const nextPeriodStr = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;
    const future = await generateExpectationForPeriod(admin, { policyId: policy.id, period: nextPeriodStr });
    expect(future.status).toBe("CREATED");
    if (future.status === "CREATED") createdExpectationIds.push(future.expectationId);
    const futureExp = await prisma.commissionExpectation.findUnique({
      where: { id: (future as { expectationId: string }).expectationId },
    });
    expect(futureExp?.expectedAmount.toString()).toBe("50");
  });

  // Fase 022 (Hallazgo #8 de UAT): regla de comisión PER_MEMBER. Se
  // investigó el flujo completo (form -> FormData -> action -> Zod ->
  // servicio -> Prisma -> DTO -> UI) y una reproducción manual en
  // navegador — la base se persiste y se recupera correctamente en el
  // estado actual del código; estos tests fijan ese comportamiento
  // como regresión explícita, exactamente con el caso obligatorio de
  // la ficha (FIXED_AMOUNT + PER_MEMBER + $25 + MONTHLY).
  describe("Hallazgo #8 — CommissionRule PER_MEMBER persiste y se calcula correctamente", () => {
    it("PER_MEMBER persiste tal cual tras guardar (nunca se pierde ni cae a FIXED)", async () => {
      const rule = await createCommissionRule(admin, {
        productId,
        method: "FIXED_AMOUNT",
        base: "PER_MEMBER",
        initialAmount: "25.00",
        initialPeriodicity: "MONTHLY",
      });
      createdRuleIds.push(rule.id);
      expect(rule.base).toBe("PER_MEMBER");
      expect(rule.method).toBe("FIXED_AMOUNT");
    });

    it("PER_MEMBER sigue persistiendo tras 'recargar' (releer desde una consulta nueva, nunca el objeto en memoria)", async () => {
      const rule = await createCommissionRule(admin, {
        productId,
        method: "FIXED_AMOUNT",
        base: "PER_MEMBER",
        initialAmount: "25.00",
        initialPeriodicity: "MONTHLY",
      });
      createdRuleIds.push(rule.id);

      // "Volver a abrir producto" — misma consulta que usa la página
      // de edición del producto, nunca el objeto ya en memoria.
      const reloaded = await listCommissionRulesForProduct(admin, productId);
      const found = reloaded.find((r) => r.id === rule.id);
      expect(found?.base).toBe("PER_MEMBER");
    });

    it("3 PolicyMembers cubiertos x $25 (PER_MEMBER) = $75, nunca $25", async () => {
      const holder = await makePerson();
      const spouse = await makePerson();
      const child = await makePerson();
      const policy = await createPolicy(admin, {
        holderId: holder.id,
        productId,
        holderCovered: "true",
        coveredMembers: [
          { personId: spouse.id, role: "SPOUSE" },
          { personId: child.id, role: "DEPENDENT" },
        ],
        effectiveDate: new Date("2026-01-15"),
      });
      createdPolicyIds.push(policy.id);

      const rule = await createCommissionRule(admin, {
        productId,
        method: "FIXED_AMOUNT",
        base: "PER_MEMBER",
        initialAmount: "25.00",
        initialPeriodicity: "MONTHLY",
      });
      createdRuleIds.push(rule.id);

      const result = await generateExpectationForPeriod(admin, { policyId: policy.id, period: "2026-01" });
      expect(result.status).toBe("CREATED");
      if (result.status === "CREATED") {
        createdExpectationIds.push(result.expectationId);
        const exp = await prisma.commissionExpectation.findUnique({ where: { id: result.expectationId } });
        expect(exp?.expectedAmount.toString()).toBe("75");
      }
    });
  });
});
