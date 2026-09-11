import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCommissionAnalytics } from "@/services/commission-analytics.service";
import { createCommissionExpectation, addCommissionPayment } from "@/services/commissions.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdExpectationIds: string[] = [];
const createdStatementIds: string[] = [];

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
      isAgent: role === "AGENT",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: uniqueName("PersonAnalytics"),
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makePolicyFor(
  actor: AuthorizedUser,
  holder: { id: string },
  extra: Record<string, unknown> = {}
) {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Analytics") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Analytics"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
    ...extra,
  });
  createdPolicyIds.push(policy.id);
  return { policy, carrier, product };
}

function futurePeriod(offsetMonths: number): { period: string; year: number; month: number } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return { period: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;
let periodCounter = 500;

function nextPeriod() {
  periodCounter += 1;
  return futurePeriod(periodCounter);
}

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-analytics");
  agent = await makeActor("AGENT", "agent-analytics");
  assistant = await makeActor("ASSISTANT", "assistant-analytics");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionExpectation.deleteMany({ where: { id: { in: createdExpectationIds } } });
  await prisma.commissionStatementRow.deleteMany({ where: { statementId: { in: createdStatementIds } } });
  await prisma.commissionStatement.deleteMany({ where: { id: { in: createdStatementIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("commission-analytics.service (AMPLIACIÓN PREPRODUCCIÓN)", () => {
  it("ASSISTANT es rechazado — sin acceso al módulo de comisiones", async () => {
    await expect(getCommissionAnalytics(assistant, {})).rejects.toThrow(AppError);
  });

  it("calcula esperado/recibido/pendiente/diferencia sobre TODO el universo filtrado (mes exacto)", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const { period, year, month } = nextPeriod();

    const expectation = await createCommissionExpectation(admin, {
      policyId: policy.id,
      period,
      expectedAmount: "100.00",
    });
    createdExpectationIds.push(expectation.id);
    await addCommissionPayment(admin, expectation.id, {
      type: "PAYMENT",
      amount: "60.00",
      receivedAt: new Date(),
    });

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    expect(result.overall.expected.toString()).toBe("100");
    expect(result.overall.receivedGross.toString()).toBe("60");
    expect(result.overall.pending.toString()).toBe("40");
    expect(result.overall.difference.toString()).toBe("-40");
    expect(result.overall.overpaid.toString()).toBe("0");
  });

  it("Pagado de más: recibido > esperado", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const { period, year, month } = nextPeriod();

    const expectation = await createCommissionExpectation(admin, {
      policyId: policy.id,
      period,
      expectedAmount: "50.00",
    });
    createdExpectationIds.push(expectation.id);
    await addCommissionPayment(admin, expectation.id, { type: "PAYMENT", amount: "80.00", receivedAt: new Date() });

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    expect(result.overall.overpaid.toString()).toBe("30");
    expect(result.overall.pending.toString()).toBe("0");
    expect(result.overall.difference.toString()).toBe("30");
  });

  it("Pagos sin expectativa: un CommissionPayment sin commissionExpectationId cuenta aparte", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const { year, month } = nextPeriod();
    const periodDate = new Date(Date.UTC(year, month - 1, 1));

    await prisma.commissionPayment.create({
      data: {
        policyId: policy.id,
        period: periodDate,
        amount: "15.00",
        type: "PAYMENT",
        receivedAt: new Date(),
      },
    });

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    expect(result.overall.paymentsWithoutExpectationCount).toBe(1);
    expect(result.overall.paymentsWithoutExpectationAmount.toString()).toBe("15");
    // También cuenta en el recibido bruto general — nunca se excluye
    // silenciosamente solo porque no está ligado a una expectativa.
    expect(result.overall.receivedGross.toString()).toBe("15");
  });

  it("Asistencia y neto recibido: solo pagos ligados a una fila de statement contribuyen asistencia", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const { period, year, month } = nextPeriod();

    const expectation = await createCommissionExpectation(admin, {
      policyId: policy.id,
      period,
      expectedAmount: "50.00",
    });
    createdExpectationIds.push(expectation.id);
    const updatedExpectation = await addCommissionPayment(admin, expectation.id, {
      type: "PAYMENT",
      amount: "50.00",
      receivedAt: new Date(),
    });
    const createdPayment = updatedExpectation.payments[updatedExpectation.payments.length - 1];

    const statement = await prisma.commissionStatement.create({
      data: {
        source: "TEST",
        fileName: "test.pdf",
        fingerprint: uniqueName("fingerprint"),
        totalRows: 1,
        receivedTotal: "50.00",
      },
    });
    createdStatementIds.push(statement.id);
    const row = await prisma.commissionStatementRow.create({
      data: {
        statementId: statement.id,
        rowNumber: 1,
        receivedAmount: "50.00",
        assistanceAmount: "6.00",
        netAmount: "44.00",
        matchStatus: "APPLIED",
      },
    });
    await prisma.commissionPayment.update({ where: { id: createdPayment.id }, data: { statementRowId: row.id } });

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    expect(result.overall.assistance.toString()).toBe("6");
    expect(result.overall.netReceived.toString()).toBe("44");
  });

  it("estados de conciliación: distribuye por el vocabulario derivado general (PENDING/PAID/etc.)", async () => {
    const holder = await makePerson(agent.id);
    const { policy: paidPolicy } = await makePolicyFor(admin, holder);
    const { policy: pendingPolicy } = await makePolicyFor(admin, holder);
    const { period, year, month } = nextPeriod();

    const paidExpectation = await createCommissionExpectation(admin, {
      policyId: paidPolicy.id,
      period,
      expectedAmount: "20.00",
    });
    createdExpectationIds.push(paidExpectation.id);
    await addCommissionPayment(admin, paidExpectation.id, { type: "PAYMENT", amount: "20.00", receivedAt: new Date() });

    const pendingExpectation = await createCommissionExpectation(admin, {
      policyId: pendingPolicy.id,
      period,
      expectedAmount: "30.00",
    });
    createdExpectationIds.push(pendingExpectation.id);

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    const paidBucket = result.charts.reconciliationStatus.find((r) => r.status === "PAID");
    const pendingBucket = result.charts.reconciliationStatus.find((r) => r.status === "PENDING");
    expect(paidBucket?.count).toBeGreaterThanOrEqual(1);
    expect(pendingBucket?.count).toBeGreaterThanOrEqual(1);
  });

  it("AGENT solo ve su propio universo (agentCommissionAccessWhere) — no el de otro agente", async () => {
    const otherAgent = await makeActor("AGENT", "other-agent-analytics");
    const holderOfOther = await makePerson(otherAgent.id);
    const { policy } = await makePolicyFor(admin, holderOfOther);
    const { period, year, month } = nextPeriod();

    const expectation = await createCommissionExpectation(admin, {
      policyId: policy.id,
      period,
      expectedAmount: "99.00",
    });
    createdExpectationIds.push(expectation.id);

    const resultAsAgent = await getCommissionAnalytics(agent, { periodMode: "MONTH", year, month });
    expect(resultAsAgent.overall.expected.toString()).not.toBe("99");

    const resultAsAdmin = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month });
    expect(Number(resultAsAdmin.overall.expected.toString())).toBeGreaterThanOrEqual(99);
  });

  it("filtro por carrier específico omite el desglose 'por carrier' (redundante con el total)", async () => {
    const holder = await makePerson(agent.id);
    const { policy, carrier } = await makePolicyFor(admin, holder);
    const { period, year, month } = nextPeriod();
    const expectation = await createCommissionExpectation(admin, { policyId: policy.id, period, expectedAmount: "10.00" });
    createdExpectationIds.push(expectation.id);

    const result = await getCommissionAnalytics(admin, { periodMode: "MONTH", year, month, carrierId: carrier.id });
    expect(result.charts.byCarrier).toEqual([]);
  });
});
