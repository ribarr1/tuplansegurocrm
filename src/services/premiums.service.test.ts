import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listPremiumTracking,
  getPremiumTrackingForPolicy,
  updatePremiumTracking,
  markPaymentCurrent,
  markPaymentDue,
  markPaymentPastDue,
  isPaymentOverdue,
} from "@/services/premiums.service";
import { createPolicy, getPolicyById } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

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
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Premium") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Premium"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
    ...extra,
  });
  return { policy: trackPolicy(policy), carrierId: carrier.id };
}

function dateOnlyString(offsetDays: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-prem");
  agent = await makeActor("AGENT", "agent-prem");
  agentB = await makeActor("AGENT", "agentb-prem");
  assistant = await makeActor("ASSISTANT", "assistant-prem");
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("premiums.service", () => {
  it("A) lista Policy con premium configurado", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder, { premiumAmount: "125.50" });
    const { items } = await listPremiumTracking(admin, { pageSize: 100 });
    const found = items.find((i) => i.id === policy.id);
    expect(found).toBeDefined();
    expect(found?.premiumAmount?.toString()).toBe("125.5");
  });

  it("B) Policy sin premium configurado funciona (todo null)", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const found = await getPremiumTrackingForPolicy(admin, policy.id);
    expect(found.premiumAmount).toBeNull();
    expect(found.billingFrequency).toBeNull();
    expect(found.nextPaymentDueDate).toBeNull();
    expect(found.paymentStatus).toBeNull();
    expect(found.autopay).toBe(false);
    expect(found.needsPaymentAssistance).toBe(false);
    expect(found.isOverdue).toBe(false);
  });

  it("C) nextPaymentDueDate date-only conserva el día exacto", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const updated = await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: "2026-12-25",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    expect(updated.nextPaymentDueDate?.getUTCFullYear()).toBe(2026);
    expect(updated.nextPaymentDueDate?.getUTCMonth()).toBe(11);
    expect(updated.nextPaymentDueDate?.getUTCDate()).toBe(25);
  });

  it("D) vencimiento hoy se marca correctamente (no overdue, pero es 'hoy')", () => {
    const today = { year: 2026, month: 8, day: 31 };
    const overdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2026, 7, 31)), paymentStatus: "DUE" },
      today
    );
    expect(overdue).toBe(false);
  });

  it("E) vencido (fecha pasada, no CURRENT) se marca overdue", () => {
    const today = { year: 2026, month: 8, day: 31 };
    const overdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2026, 7, 30)), paymentStatus: "PAST_DUE" },
      today
    );
    expect(overdue).toBe(true);
  });

  it("F) futuro no se marca overdue", () => {
    const today = { year: 2026, month: 8, day: 31 };
    const overdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2026, 8, 1)), paymentStatus: "DUE" },
      today
    );
    expect(overdue).toBe(false);
  });

  it("G) paymentStatus CURRENT nunca se marca overdue aunque la fecha ya pasó", () => {
    const today = { year: 2026, month: 8, day: 31 };
    const overdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2026, 7, 1)), paymentStatus: "CURRENT" },
      today
    );
    expect(overdue).toBe(false);
  });

  it("H) filtro needsAssistance", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      autopay: "false",
      needsPaymentAssistance: "true",
    });
    const { items } = await listPremiumTracking(admin, { needsAssistance: "true", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
    expect(items.every((i) => i.needsPaymentAssistance)).toBe(true);
  });

  it("I) filtro autopay", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, { autopay: "true", needsPaymentAssistance: "false" });
    const { items } = await listPremiumTracking(admin, { autopay: "true", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
    expect(items.every((i) => i.autopay)).toBe(true);
  });

  it("J) filtro paymentStatus", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await markPaymentPastDue(admin, policy.id);
    const { items } = await listPremiumTracking(admin, { paymentStatus: "PAST_DUE", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
    expect(items.every((i) => i.paymentStatus === "PAST_DUE")).toBe(true);
  });

  it("K) filtro carrier", async () => {
    const holder = await makePerson();
    const { policy, carrierId } = await makePolicyFor(admin, holder);
    const { items } = await listPremiumTracking(admin, { carrierId, pageSize: 100 });
    expect(items.map((i) => i.id)).toContain(policy.id);
    expect(items.every((i) => i.product.carrier.id === carrierId)).toBe(true);
  });

  it("L) próximos 7 días incluye una fecha dentro de la ventana", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: dateOnlyString(3),
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const { items } = await listPremiumTracking(admin, { next7Days: "true", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
  });

  it("M) próximos 30 días incluye una fecha dentro de la ventana pero fuera de 7 días", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: dateOnlyString(20),
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const { items: items7 } = await listPremiumTracking(admin, { next7Days: "true", pageSize: 100 });
    expect(items7.some((i) => i.id === policy.id)).toBe(false);
    const { items: items30 } = await listPremiumTracking(admin, { next30Days: "true", pageSize: 100 });
    expect(items30.some((i) => i.id === policy.id)).toBe(true);
  });

  it("N) borde diciembre/enero: overdue se calcula correctamente cruzando el año", () => {
    const today = { year: 2027, month: 1, day: 2 };
    const overdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2026, 11, 30)), paymentStatus: "DUE" },
      today
    );
    expect(overdue).toBe(true);
    const notOverdue = isPaymentOverdue(
      { nextPaymentDueDate: new Date(Date.UTC(2027, 0, 5)), paymentStatus: "DUE" },
      today
    );
    expect(notOverdue).toBe(false);
  });

  it("O) ADMIN ve todas las pólizas en el listado", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const { items } = await listPremiumTracking(admin, { pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
  });

  it("P) AGENT ve pólizas dentro de su acceso", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const found = await getPremiumTrackingForPolicy(agent, policy.id);
    expect(found.id).toBe(policy.id);
  });

  it("Q) AGENT no ve pólizas fuera de su acceso", async () => {
    const holder = await makePerson(agentB.id);
    const { policy } = await makePolicyFor(admin, holder);
    await expect(getPremiumTrackingForPolicy(agent, policy.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("R) ASSISTANT tiene acceso completo (a diferencia de Comisiones)", async () => {
    const holder = await makePerson(agent.id);
    const { policy } = await makePolicyFor(admin, holder);
    const found = await getPremiumTrackingForPolicy(assistant, policy.id);
    expect(found.id).toBe(policy.id);
    const updated = await updatePremiumTracking(assistant, policy.id, {
      premiumAmount: "99.99",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    expect(updated.premiumAmount?.toString()).toBe("99.99");
  });

  it("S) update de campos de seguimiento funciona", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const updated = await updatePremiumTracking(admin, policy.id, {
      premiumAmount: "200.00",
      billingFrequency: "MONTHLY",
      autopay: "true",
      needsPaymentAssistance: "false",
      paymentStatus: "DUE",
    });
    expect(updated.billingFrequency).toBe("MONTHLY");
    expect(updated.autopay).toBe(true);
    expect(updated.paymentStatus).toBe("DUE");
  });

  it("T) Decimal preservado con precisión exacta (sin errores de punto flotante)", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const updated = await updatePremiumTracking(admin, policy.id, {
      premiumAmount: "100.10",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    expect(updated.premiumAmount?.toString()).toBe("100.1");
  });

  it("U) markPaymentCurrent funciona (equivalente operativo a 'pagado/al día')", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await markPaymentDue(admin, policy.id);
    const updated = await markPaymentCurrent(admin, policy.id);
    expect(updated.paymentStatus).toBe("CURRENT");
  });

  it("V) marcar al día NO cambia nextPaymentDueDate automáticamente", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const withDate = await updatePremiumTracking(admin, policy.id, {
      nextPaymentDueDate: "2026-09-15",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const marked = await markPaymentCurrent(admin, policy.id);
    expect(marked.nextPaymentDueDate?.getTime()).toBe(withDate.nextPaymentDueDate?.getTime());
  });

  it("W) update de seguimiento no modifica otros campos de Policy", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder, { policyNumber: "PN-PREMIUM-TEST" });
    await updatePremiumTracking(admin, policy.id, {
      premiumAmount: "50.00",
      autopay: "false",
      needsPaymentAssistance: "false",
    });
    const reloaded = await getPolicyById(admin, policy.id);
    expect(reloaded.policyNumber).toBe("PN-PREMIUM-TEST");
    expect(reloaded.status).toBe("PENDING");
    expect(reloaded.holder.id).toBe(holder.id);
  });

  it("Y) el listado nunca incluye datos de Comisiones/Salud", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const { items } = await listPremiumTracking(admin, { pageSize: 100 });
    const found = items.find((i) => i.id === policy.id);
    expect(found).not.toHaveProperty("commissionExpectations");
    expect(found).not.toHaveProperty("healthDetail");
  });

  it("Z) el detalle de seguimiento no expone información restringida adicional", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    const found = await getPremiumTrackingForPolicy(admin, policy.id);
    expect(found).not.toHaveProperty("commissionExpectations");
    expect(found).not.toHaveProperty("healthDetail");
    const keys = Object.keys(found);
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "policyNumber",
        "premiumAmount",
        "billingFrequency",
        "nextPaymentDueDate",
        "autopay",
        "needsPaymentAssistance",
        "paymentStatus",
        "holder",
        "product",
        "isOverdue",
      ])
    );
  });

  // Fase 019.5 — regresión: un <select> sin cambiar en un <form
  // method="GET"> envía "" (string vacío), no ausencia de la clave.
  // Antes de esta fase, autopay/needsAssistance/paymentStatus usaban
  // z.enum(["true","false"]) sin z.preprocess(emptyStringToUndefined,
  // ...), así que "" producía VALIDATION_ERROR en vez de "sin filtro".
  it("AB) filtros vacíos de /premiums no fallan (autopay/needsAssistance/paymentStatus/carrierId/agentId)", async () => {
    await expect(
      listPremiumTracking(admin, {
        autopay: "",
        needsAssistance: "",
        paymentStatus: "",
        carrierId: "",
        agentId: "",
        dueToday: "",
        overdueOnly: "",
      })
    ).resolves.toBeDefined();
  });

  it("AC) autopay=true filtra correctamente", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, { autopay: "true", needsPaymentAssistance: "false" });
    const { items } = await listPremiumTracking(admin, { autopay: "true", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
  });

  it("AD) autopay=false filtra correctamente", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, { autopay: "false", needsPaymentAssistance: "false" });
    const { items } = await listPremiumTracking(admin, { autopay: "false", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
    expect(items.every((i) => !i.autopay)).toBe(true);
  });

  // Fase 022 (Hallazgo #6A de UAT): coherencia de fechas de póliza/pago.
  it("rechaza nextPaymentDueDate anterior a effectiveDate", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder, { effectiveDate: "2026-10-01" });
    await expect(
      updatePremiumTracking(admin, policy.id, {
        autopay: "false",
        needsPaymentAssistance: "false",
        nextPaymentDueDate: "2025-10-01",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("acepta nextPaymentDueDate igual o posterior a effectiveDate", async () => {
    const holder = await makePerson();
    const { policy } = await makePolicyFor(admin, holder, { effectiveDate: "2026-10-01" });
    await expect(
      updatePremiumTracking(admin, policy.id, {
        autopay: "false",
        needsPaymentAssistance: "false",
        nextPaymentDueDate: "2026-11-01",
      })
    ).resolves.toBeDefined();
  });
});
