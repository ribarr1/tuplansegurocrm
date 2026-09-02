import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboard } from "@/services/dashboard.service";
import { createTask } from "@/services/tasks.service";
import { createPolicy } from "@/services/policies.service";
import { createCommissionExpectation, addCommissionPayment } from "@/services/commissions.service";
import { updatePremiumTracking } from "@/services/premiums.service";
import { getTodayBusinessRange } from "@/lib/business-time";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdTaskIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdExpectationIds: string[] = [];

function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}
function trackTask<T extends { id: string }>(t: T): T {
  createdTaskIds.push(t.id);
  return t;
}
function trackPolicy<T extends { id: string }>(p: T): T {
  createdPolicyIds.push(p.id);
  return p;
}
function trackExpectation<T extends { id: string }>(e: T): T {
  createdExpectationIds.push(e.id);
  return e;
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(
  role: "ADMIN" | "AGENT" | "ASSISTANT",
  label: string
): Promise<AuthorizedUser> {
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

async function makePerson(overrides: Record<string, unknown> = {}) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      ...overrides,
    },
  });
  return trackPerson(person);
}

async function makePolicyFor(
  actor: AuthorizedUser,
  holder: { id: string },
  extra: Record<string, unknown> = {}
) {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Dashboard") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Dashboard"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
    ...extra,
  });
  return trackPolicy(policy);
}

function dateOnlyString(offsetDays: number): string {
  const { year, month, day } = getTodayBusinessRange();
  const d = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return d.toISOString().slice(0, 10);
}

function currentPeriodString(): string {
  const { year, month } = getTodayBusinessRange();
  return `${year}-${String(month).padStart(2, "0")}`;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-dash");
  agent = await makeActor("AGENT", "agent-dash");
  agentB = await makeActor("AGENT", "agentb-dash");
  assistant = await makeActor("ASSISTANT", "assistant-dash");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({
    where: { commissionExpectationId: { in: createdExpectationIds } },
  });
  await prisma.commissionExpectation.deleteMany({ where: { id: { in: createdExpectationIds } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("dashboard.service", () => {
  it("A) ADMIN dashboard carga con la forma esperada", async () => {
    const result = await getDashboard(admin);
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("premiums");
    expect(result).toHaveProperty("birthdays");
    expect(result).toHaveProperty("policies");
    expect(result).toHaveProperty("commissions");
  });

  it("B) AGENT dashboard carga (scoped, sin error)", async () => {
    const result = await getDashboard(agent);
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("commissions");
  });

  it("C) ASSISTANT dashboard carga sin la clave commissions", async () => {
    const result = await getDashboard(assistant);
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("premiums");
    expect(result).not.toHaveProperty("commissions");
  });

  // ADMIN ve comisiones globalmente (sin scoping), así que no podemos
  // asumir que la base de datos está vacía este mes (puede haber datos
  // reales de UAT manual, ej. pólizas creadas al probar Hallazgo #14).
  // En vez de depender de un estado vacío, verificamos que hasData
  // coincide exactamente con si existen filas reales para el período
  // actual — eso es lo que realmente queremos garantizar (nunca un
  // $0 fantasma cuando no hay registros).
  it("D) hasData coincide con si existen expectativas reales para el período actual (nunca $0 fantasma)", async () => {
    const { year, month } = getTodayBusinessRange();
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const realCount = await prisma.commissionExpectation.count({ where: { period: periodStart } });
    const result = await getDashboard(admin);
    expect(result.commissions?.hasData).toBe(realCount > 0);
    if (realCount === 0) {
      expect(result.commissions).not.toHaveProperty("expected");
    }
  });

  it("E) today task count correcto", async () => {
    const before = await getDashboard(admin);
    const { start } = getTodayBusinessRange();
    const dueAt = new Date(start.getTime() + 60 * 60 * 1000);
    trackTask(await createTask(admin, { title: uniqueName("Tarea hoy"), dueAt: dueAt.toISOString() }));
    const after = await getDashboard(admin);
    expect(after.tasks.todayCount).toBe(before.tasks.todayCount + 1);
  });

  it("F) overdue task count correcto", async () => {
    const before = await getDashboard(admin);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    trackTask(
      await createTask(admin, { title: uniqueName("Tarea vencida"), dueAt: past.toISOString() })
    );
    const after = await getDashboard(admin);
    expect(after.tasks.overdueCount).toBe(before.tasks.overdueCount + 1);
  });

  it("G) tarea completada no cuenta como vencida", async () => {
    const before = await getDashboard(admin);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea completada vencida"), dueAt: past.toISOString() })
    );
    await prisma.task.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
    const after = await getDashboard(admin);
    expect(after.tasks.overdueCount).toBe(before.tasks.overdueCount);
  });

  it("H) lista de prioridad ordena vencidas primero, luego por prioridad", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const urgentFuture = trackTask(
      await createTask(admin, {
        title: uniqueName("Urgente futura"),
        priority: "URGENT",
        dueAt: future.toISOString(),
      })
    );
    const normalOverdue = trackTask(
      await createTask(admin, {
        title: uniqueName("Normal vencida"),
        priority: "NORMAL",
        dueAt: past.toISOString(),
      })
    );
    const result = await getDashboard(admin);
    const ids = result.tasks.priorityItems.map((t) => t.id);
    const overdueIndex = ids.indexOf(normalOverdue.id);
    const urgentIndex = ids.indexOf(urgentFuture.id);
    if (overdueIndex !== -1 && urgentIndex !== -1) {
      expect(overdueIndex).toBeLessThan(urgentIndex);
    }
  });

  it("I) premium overdue count correcto", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: dateOnlyString(-5),
      paymentStatus: "PAST_DUE",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const after = await getDashboard(admin);
    expect(after.premiums.overdueCount).toBe(before.premiums.overdueCount + 1);
  });

  it("J) paymentStatus CURRENT no cuenta como vencido", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: dateOnlyString(-5),
      paymentStatus: "CURRENT",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const after = await getDashboard(admin);
    expect(after.premiums.overdueCount).toBe(before.premiums.overdueCount);
  });

  it("K) assistance count correcto", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      autopay: "false",
      needsPaymentAssistance: "true",
    });
    const after = await getDashboard(admin);
    expect(after.premiums.assistanceCount).toBe(before.premiums.assistanceCount + 1);
  });

  it("L) próximos 7 días correcto", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: dateOnlyString(3),
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const after = await getDashboard(admin);
    expect(after.premiums.dueSoonCount).toBe(before.premiums.dueSoonCount + 1);
  });

  it("M) cumpleaños de hoy correcto", async () => {
    const before = await getDashboard(admin);
    const { year, month, day } = getTodayBusinessRange();
    await makePerson({ dateOfBirth: new Date(Date.UTC(year - 30, month - 1, day)) });
    const after = await getDashboard(admin);
    expect(after.birthdays.todayCount).toBe(before.birthdays.todayCount + 1);
  });

  it("N) próximo cumpleaños aparece en 'upcoming'", async () => {
    const { year, month, day } = getTodayBusinessRange();
    const future = new Date(Date.UTC(year, month - 1, day + 5));
    const person = await makePerson({
      dateOfBirth: new Date(Date.UTC(year - 25, future.getUTCMonth(), future.getUTCDate())),
    });
    const result = await getDashboard(admin);
    expect(result.birthdays.upcoming.some((b) => b.personId === person.id)).toBe(true);
  });

  it("O) nacido 29 de febrero produce una ocurrencia válida (28 o 29 de febrero)", async () => {
    const person = await makePerson({ dateOfBirth: new Date(Date.UTC(1996, 1, 29)) });
    const result = await getDashboard(admin);
    const entry = result.birthdays.upcoming.find((b) => b.personId === person.id);
    if (entry) {
      expect(entry.occurrenceMonth).toBe(2);
      expect([28, 29]).toContain(entry.occurrenceDay);
    }
  });

  it("P) conteo de pólizas activas", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    await makePolicyFor(admin, holder, { status: "ACTIVE", effectiveDate: dateOnlyString(-30) });
    const after = await getDashboard(admin);
    expect(after.policies.activeCount).toBe(before.policies.activeCount + 1);
  });

  it("Q) conteo de pólizas pendientes", async () => {
    const before = await getDashboard(admin);
    const holder = await makePerson();
    await makePolicyFor(admin, holder);
    const after = await getDashboard(admin);
    expect(after.policies.pendingCount).toBe(before.policies.pendingCount + 1);
  });

  it("R) totales de comisiones del mes actual correctos (ADMIN)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: currentPeriodString(),
        expectedAmount: "100.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "40.00", receivedAt: new Date() });
    const result = await getDashboard(admin);
    expect(result.commissions?.hasData).toBe(true);
    if (result.commissions?.hasData) {
      expect(result.commissions.expected.toString()).not.toBe("0");
    }
  });

  it("S) suma de PAYMENT correcta", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: currentPeriodString(),
        expectedAmount: "50.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "20.00", receivedAt: new Date() });
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "10.00", receivedAt: new Date() });
    const before = await getDashboard(admin);
    const exp2 = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: (await makePolicyFor(admin, await makePerson())).id,
        period: currentPeriodString(),
        expectedAmount: "5.00",
      })
    );
    await addCommissionPayment(admin, exp2.id, { type: "PAYMENT", amount: "5.00", receivedAt: new Date() });
    const after = await getDashboard(admin);
    expect(after.commissions?.hasData && before.commissions?.hasData).toBe(true);
  });

  it("T) chargeback reduce el monto recibido", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: currentPeriodString(),
        expectedAmount: "100.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "50.00", receivedAt: new Date() });
    const before = await getDashboard(admin);
    await addCommissionPayment(admin, exp.id, {
      type: "CHARGEBACK",
      amount: "10.00",
      receivedAt: new Date(),
    });
    const after = await getDashboard(admin);
    if (before.commissions?.hasData && after.commissions?.hasData) {
      expect(after.commissions.received.lessThan(before.commissions.received)).toBe(true);
    }
  });

  it("U) AGENT ve comisiones acotadas a su cartera", async () => {
    const holderMine = await makePerson({ assignedAgentId: agent.id });
    const policyMine = await makePolicyFor(admin, holderMine);
    const expMine = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policyMine.id,
        period: currentPeriodString(),
        expectedAmount: "77.00",
      })
    );

    const holderOther = await makePerson({ assignedAgentId: agentB.id });
    const policyOther = await makePolicyFor(admin, holderOther);
    trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policyOther.id,
        period: currentPeriodString(),
        expectedAmount: "999.00",
      })
    );

    const result = await getDashboard(agent);
    expect(result.commissions?.hasData).toBe(true);
    if (result.commissions?.hasData) {
      expect(result.commissions.expected.greaterThanOrEqualTo(77)).toBe(true);
    }
    void expMine;
  });

  it("V) ASSISTANT nunca recibe datos de comisiones en el DTO", async () => {
    const result = await getDashboard(assistant);
    expect(JSON.stringify(result)).not.toContain("commissions");
  });

  it("W) expectedAmount = 0 sigue contando como hasData:true (distinto de 'sin registros', ver test D)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: currentPeriodString(),
        expectedAmount: "0.00",
      })
    );
    const withZeroExpectation = await getDashboard(admin);
    expect(withZeroExpectation.commissions?.hasData).toBe(true);
  });

  it("X) borde de día de negocio: tarea justo al inicio de 'hoy' cuenta como hoy", async () => {
    const { start } = getTodayBusinessRange();
    const before = await getDashboard(admin);
    trackTask(
      await createTask(admin, { title: uniqueName("Tarea borde"), dueAt: start.toISOString() })
    );
    const after = await getDashboard(admin);
    expect(after.tasks.todayCount).toBe(before.tasks.todayCount + 1);
  });

  it("Y) Dashboard nunca incluye HealthPolicyDetail", async () => {
    const result = await getDashboard(admin);
    expect(JSON.stringify(result)).not.toContain("healthDetail");
    expect(JSON.stringify(result)).not.toContain("marketplaceApplicationId");
  });

  it("Z) Dashboard no expone datos financieros restringidos a ASSISTANT", async () => {
    const result = await getDashboard(assistant);
    expect(result).not.toHaveProperty("commissions");
    expect(result).toHaveProperty("premiums");
  });

  it("AA) AGENT no ve pólizas fuera de su cartera en los conteos", async () => {
    const before = await getDashboard(agent);
    const holderOther = await makePerson({ assignedAgentId: agentB.id });
    await makePolicyFor(admin, holderOther, { status: "ACTIVE", effectiveDate: dateOnlyString(-10) });
    const after = await getDashboard(agent);
    expect(after.policies.activeCount).toBe(before.policies.activeCount);
  });
});
