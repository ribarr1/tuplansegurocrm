import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCommissionExpectations,
  getCommissionExpectationById,
  getCommissionsForPolicy,
  createCommissionExpectation,
  updateCommissionExpectation,
  cancelCommissionExpectation,
  addCommissionPayment,
  computeCommissionStatus,
  sumPayments,
  getCommissionTotalsForPeriod,
} from "@/services/commissions.service";
import { createPolicy, getPolicyById } from "@/services/policies.service";
import { createCommissionRule, generateExpectationForPeriod } from "@/services/commission-rules.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdExpectationIds: string[] = [];

function trackExpectation<T extends { id: string }>(e: T): T {
  createdExpectationIds.push(e.id);
  return e;
}
function trackPolicy<T extends { id: string }>(p: T): T {
  createdPolicyIds.push(p.id);
  return p;
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(
  role: "ADMIN" | "AGENT" | "ASSISTANT",
  label: string,
  isActive = true
): Promise<AuthorizedUser> {
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

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
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
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Commission") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Commission"), policyType: "HEALTH" },
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

function futurePeriod(offsetMonths: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;
let periodCounter = 100;

function nextPeriod(): string {
  periodCounter += 1;
  return futurePeriod(periodCounter);
}

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-comm");
  agent = await makeActor("AGENT", "agent-comm");
  agentB = await makeActor("AGENT", "agentb-comm");
  assistant = await makeActor("ASSISTANT", "assistant-comm");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({
    where: { commissionExpectationId: { in: createdExpectationIds } },
  });
  await prisma.commissionExpectation.deleteMany({ where: { id: { in: createdExpectationIds } } });
  // Reglas de comisión creadas en las pruebas de override (Fase 019.7)
  // — deben limpiarse antes de borrar los productos que referencian.
  await prisma.commissionRule.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("commissions.service", () => {
  it("A) crear expectativa queda ACTIVE por defecto", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    expect(exp.status).toBe("ACTIVE");
    expect(exp.agentId).toBeNull();
  });

  it("B) período se normaliza al primer día del mes", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const period = nextPeriod();
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period,
        expectedAmount: "50.00",
      })
    );
    expect(exp.period.getUTCDate()).toBe(1);
    const [year, month] = period.split("-").map(Number);
    expect(exp.period.getUTCFullYear()).toBe(year);
    expect(exp.period.getUTCMonth() + 1).toBe(month);
  });

  it("C) ADMIN puede crear con agentId válido", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
        agentId: agent.id,
      })
    );
    expect(exp.agentId).toBe(agent.id);
  });

  it("D) agentId inexistente falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
        agentId: "00000000-0000-4000-8000-000000000099",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("E) agentId de un ADMIN (no AGENT) falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
        agentId: admin.id,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("F) agentId de un AGENT inactivo falla VALIDATION_ERROR", async () => {
    const inactiveAgent = await makeActor("AGENT", "agent-inactive-comm", false);
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
        agentId: inactiveAgent.id,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("G) AGENT no puede crear expectativas (FORBIDDEN)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(agent, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("H) ASSISTANT no tiene acceso al módulo (FORBIDDEN) al crear", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(assistant, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "75.00",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("I) policyId inexistente falla NOT_FOUND", async () => {
    await expect(
      createCommissionExpectation(admin, {
        policyId: "00000000-0000-4000-8000-000000000098",
        period: nextPeriod(),
        expectedAmount: "75.00",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("J) expectedAmount negativo falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "-10.00",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("K) expectedAmount no numérico falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "abc",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("L) duplicado (policyId, period) falla CONFLICT", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const period = nextPeriod();
    trackExpectation(
      await createCommissionExpectation(admin, { policyId: policy.id, period, expectedAmount: "10.00" })
    );
    await expect(
      createCommissionExpectation(admin, { policyId: policy.id, period, expectedAmount: "20.00" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("M) ADMIN ve todas las expectativas en el listado", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "10.00",
      })
    );
    const { items } = await listCommissionExpectations(admin, { pageSize: 100 });
    expect(items.some((i) => i.id === exp.id)).toBe(true);
  });

  it("N) AGENT solo ve expectativas de pólizas a las que tiene acceso", async () => {
    const holderMine = await makePerson(agent.id);
    const policyMine = await makePolicyFor(admin, holderMine);
    const expMine = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policyMine.id,
        period: nextPeriod(),
        expectedAmount: "10.00",
      })
    );

    const holderOther = await makePerson(agentB.id);
    const policyOther = await makePolicyFor(admin, holderOther);
    const expOther = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policyOther.id,
        period: nextPeriod(),
        expectedAmount: "10.00",
      })
    );

    const { items } = await listCommissionExpectations(agent, { pageSize: 100 });
    expect(items.some((i) => i.id === expMine.id)).toBe(true);
    expect(items.some((i) => i.id === expOther.id)).toBe(false);
  });

  it("O) ASSISTANT no puede listar comisiones (FORBIDDEN)", async () => {
    await expect(listCommissionExpectations(assistant, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("P) getCommissionExpectationById: AGENT sin acceso recibe FORBIDDEN", async () => {
    const holder = await makePerson(agentB.id);
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "10.00",
      })
    );
    await expect(getCommissionExpectationById(agent, exp.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("Q) getCommissionsForPolicy retorna las expectativas de esa póliza", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "10.00",
      })
    );
    const items = await getCommissionsForPolicy(admin, policy.id);
    expect(items.map((i) => i.id)).toContain(exp.id);
  });

  it("R) addCommissionPayment PAYMENT positivo se guarda tal cual", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    const updated = await addCommissionPayment(admin, exp.id, {
      type: "PAYMENT",
      amount: "40.00",
      receivedAt: new Date(),
    });
    expect(updated.payments).toHaveLength(1);
    expect(updated.payments[0].amount.toString()).toBe("40");
  });

  it("S) addCommissionPayment PAYMENT con monto 0 falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await expect(
      addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "0.00", receivedAt: new Date() })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("T) addCommissionPayment CHARGEBACK con monto positivo se guarda negativo", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    const updated = await addCommissionPayment(admin, exp.id, {
      type: "CHARGEBACK",
      amount: "25.50",
      receivedAt: new Date(),
    });
    expect(updated.payments[0].amount.toString()).toBe("-25.5");
  });

  it("U) addCommissionPayment ADJUSTMENT preserva el signo explícito", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    const updated = await addCommissionPayment(admin, exp.id, {
      type: "ADJUSTMENT",
      amount: "-15.00",
      receivedAt: new Date(),
    });
    expect(updated.payments[0].amount.toString()).toBe("-15");
  });

  it("V) addCommissionPayment ADJUSTMENT igual a 0 falla VALIDATION_ERROR", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await expect(
      addCommissionPayment(admin, exp.id, { type: "ADJUSTMENT", amount: "0.00", receivedAt: new Date() })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("W) AGENT no puede registrar pagos (FORBIDDEN)", async () => {
    const holder = await makePerson(agent.id);
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await expect(
      addCommissionPayment(agent, exp.id, { type: "PAYMENT", amount: "10.00", receivedAt: new Date() })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("X) ASSISTANT no puede registrar pagos (FORBIDDEN)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await expect(
      addCommissionPayment(assistant, exp.id, { type: "PAYMENT", amount: "10.00", receivedAt: new Date() })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Y) no se puede registrar pagos en una expectativa CANCELLED", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await cancelCommissionExpectation(admin, exp.id);
    await expect(
      addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "10.00", receivedAt: new Date() })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Z) cancelar preserva los pagos ya registrados", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "40.00", receivedAt: new Date() });
    const cancelled = await cancelCommissionExpectation(admin, exp.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.payments).toHaveLength(1);
  });

  it("AA) update: ADMIN puede cambiar expectedAmount con pagos existentes, sin borrarlos", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "40.00", receivedAt: new Date() });
    const updated = await updateCommissionExpectation(admin, exp.id, { expectedAmount: "150.00" });
    expect(updated.expectedAmount.toString()).toBe("150");
    expect(updated.payments).toHaveLength(1);
  });

  it("AB) update: no se puede cambiar period si ya tiene pagos", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await addCommissionPayment(admin, exp.id, { type: "PAYMENT", amount: "10.00", receivedAt: new Date() });
    await expect(
      updateCommissionExpectation(admin, exp.id, { period: nextPeriod() })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("AC) update: se puede cambiar period si NO tiene pagos", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    const newPeriod = nextPeriod();
    const updated = await updateCommissionExpectation(admin, exp.id, { period: newPeriod });
    expect(updated.period.getUTCDate()).toBe(1);
  });

  it("AD) update: AGENT no puede editar (FORBIDDEN)", async () => {
    const holder = await makePerson(agent.id);
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    await expect(
      updateCommissionExpectation(agent, exp.id, { expectedAmount: "5.00" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("AE) getPolicyById nunca incluye comisiones (minimización de datos)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    const fetched = await getPolicyById(admin, policy.id);
    expect(fetched).not.toHaveProperty("commissionExpectations");
  });

  it("AF) suma de pagos usa aritmética Decimal exacta (sin errores de punto flotante)", () => {
    const total = sumPayments([{ amount: "100.10" }, { amount: "100.20" }]);
    expect(total.toString()).toBe("200.3");
  });

  describe("computeCommissionStatus (pura)", () => {
    it("AG) CANCELLED siempre gana sobre cualquier otro cálculo", () => {
      expect(computeCommissionStatus("CANCELLED", "100.00", "999.00")).toBe("CANCELLED");
    });

    it("AH) expected=0 y received=0 -> ZERO", () => {
      expect(computeCommissionStatus("ACTIVE", "0.00", "0.00")).toBe("ZERO");
    });

    it("AI) expected=0 y received!=0 -> NO_EXPECTATION", () => {
      expect(computeCommissionStatus("ACTIVE", "0.00", "25.00")).toBe("NO_EXPECTATION");
    });

    it("AJ) received=0 (expected>0) -> PENDING", () => {
      expect(computeCommissionStatus("ACTIVE", "100.00", "0.00")).toBe("PENDING");
    });

    it("AK) 0<received<expected -> PARTIAL", () => {
      expect(computeCommissionStatus("ACTIVE", "100.00", "40.00")).toBe("PARTIAL");
    });

    it("AL) received=expected -> PAID", () => {
      expect(computeCommissionStatus("ACTIVE", "100.00", "100.00")).toBe("PAID");
    });

    it("AM) received>expected -> OVERPAID", () => {
      expect(computeCommissionStatus("ACTIVE", "100.00", "150.00")).toBe("OVERPAID");
    });

    it("AN) received<0 -> NEGATIVE_BALANCE", () => {
      expect(computeCommissionStatus("ACTIVE", "100.00", "-10.00")).toBe("NEGATIVE_BALANCE");
    });
  });

  it("AO) derived status end-to-end: PENDING -> PARTIAL -> PAID -> OVERPAID vía pagos reales", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    let current = await getCommissionExpectationById(admin, exp.id);
    expect(current.derivedStatus).toBe("PENDING");

    current = await addCommissionPayment(admin, exp.id, {
      type: "PAYMENT",
      amount: "40.00",
      receivedAt: new Date(),
    });
    expect(current.derivedStatus).toBe("PARTIAL");

    current = await addCommissionPayment(admin, exp.id, {
      type: "PAYMENT",
      amount: "60.00",
      receivedAt: new Date(),
    });
    expect(current.derivedStatus).toBe("PAID");

    current = await addCommissionPayment(admin, exp.id, {
      type: "PAYMENT",
      amount: "20.00",
      receivedAt: new Date(),
    });
    expect(current.derivedStatus).toBe("OVERPAID");
    expect(current.difference.toString()).toBe("-20");
  });

  it("AP) getCommissionTotalsForPeriod suma TODO el período, no solo una página (>100 expectativas)", async () => {
    const period = nextPeriod();
    const ROW_COUNT = 105;
    let expectedTotal = 0;
    let receivedTotal = 0;

    for (let i = 0; i < ROW_COUNT; i += 1) {
      const holder = await makePerson();
      const policy = await makePolicyFor(admin, holder);
      const exp = trackExpectation(
        await createCommissionExpectation(admin, {
          policyId: policy.id,
          period,
          expectedAmount: "10.00",
        })
      );
      expectedTotal += 10;
      if (i % 2 === 0) {
        await addCommissionPayment(admin, exp.id, {
          type: "PAYMENT",
          amount: "4.00",
          receivedAt: new Date(),
        });
        receivedTotal += 4;
      }
    }

    const totals = await getCommissionTotalsForPeriod(admin, { period });
    expect(totals.hasData).toBe(true);
    if (totals.hasData) {
      expect(totals.expected.toString()).toBe(String(expectedTotal));
      expect(totals.received.toString()).toBe(String(receivedTotal));
      expect(totals.difference.toString()).toBe(String(expectedTotal - receivedTotal));
    }
  }, 30000);

  // -------------------------------------------------------------------
  // Override manual de una expectativa generada por regla — Fase 019.7
  // (hallazgo #14.4/#14.5 de UAT).
  // -------------------------------------------------------------------

  it("AQ) editar expectedAmount de una expectativa generada por regla la marca como override manual", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: policy.product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    expect(generated.status).toBe("CREATED");
    const expectationId = (generated as { expectationId: string }).expectationId;
    trackExpectation({ id: expectationId });

    const updated = await updateCommissionExpectation(admin, expectationId, {
      expectedAmount: "40.00",
      overrideReason: "Bono del carrier",
    });
    expect(updated.expectedAmount.toString()).toBe("40");
    expect(updated.calculatedAmount?.toString()).toBe("25");
    expect(updated.isManualOverride).toBe(true);
    expect(updated.overriddenById).toBe(admin.id);
    expect(updated.overrideReason).toBe("Bono del carrier");
    expect(updated.overriddenAt).not.toBeNull();
  });

  it("AR) el override manual NO se destruye si se vuelve a generar/recalcular (nunca se sobrescribe una fila existente)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: policy.product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    const expectationId = (generated as { expectationId: string }).expectationId;
    trackExpectation({ id: expectationId });
    await updateCommissionExpectation(admin, expectationId, { expectedAmount: "40.00" });

    // Volver a "generar" el mismo período: debe reportar ALREADY_EXISTS
    // y no tocar el monto ya corregido manualmente.
    const again = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    expect(again.status).toBe("ALREADY_EXISTS");

    const stillOverridden = await getCommissionExpectationById(admin, expectationId);
    expect(stillOverridden.expectedAmount.toString()).toBe("40");
    expect(stillOverridden.isManualOverride).toBe(true);
  });

  it("AS) un período ya con CommissionPayment (pagado) nunca se recalcula/regenera", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: policy.product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    const expectationId = (generated as { expectationId: string }).expectationId;
    trackExpectation({ id: expectationId });
    await addCommissionPayment(admin, expectationId, {
      type: "PAYMENT",
      amount: "25.00",
      receivedAt: new Date(),
    });

    const again = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    expect(again.status).toBe("ALREADY_EXISTS");

    const stillPaid = await getCommissionExpectationById(admin, expectationId);
    expect(stillPaid.payments).toHaveLength(1);
    expect(stillPaid.expectedAmount.toString()).toBe("25");
  });

  it("editar hacia el mismo valor calculado no marca override manual", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: policy.product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    const expectationId = (generated as { expectationId: string }).expectationId;
    trackExpectation({ id: expectationId });

    const updated = await updateCommissionExpectation(admin, expectationId, { expectedAmount: "25.00" });
    expect(updated.isManualOverride).toBe(false);
  });

  it("una expectativa creada manualmente (sin regla) nunca queda marcada como override", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const exp = trackExpectation(
      await createCommissionExpectation(admin, {
        policyId: policy.id,
        period: nextPeriod(),
        expectedAmount: "100.00",
      })
    );
    expect(exp.calculatedAmount).toBeNull();

    const updated = await updateCommissionExpectation(admin, exp.id, { expectedAmount: "150.00" });
    expect(updated.isManualOverride).toBe(false);
    expect(updated.calculatedAmount).toBeNull();
  });
});
