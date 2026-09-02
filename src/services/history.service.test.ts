import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getContactTimeline, getPolicyTimeline } from "@/services/history.service";
import { createPerson, updatePerson } from "@/services/people.service";
import {
  createHouseholdWithInitialMember,
  addHouseholdMember,
  updateHousehold,
} from "@/services/households.service";
import {
  createPolicy,
  updatePolicy,
  addPolicyMember,
  removePolicyMember,
  linkPolicyToHousehold,
} from "@/services/policies.service";
import { updateHealthPolicyDetail, createHealthPolicyDetail } from "@/services/health-policies.service";
import {
  createPersonMedication,
  updatePersonMedication,
  deletePersonMedication,
  createPersonProvider,
} from "@/services/health-records.service";
import { createTask, completeTask } from "@/services/tasks.service";
import { updatePremiumTracking } from "@/services/premiums.service";
import { createCommissionRule, generateExpectationForPeriod } from "@/services/commission-rules.service";
import { updateCommissionExpectation, addCommissionPayment } from "@/services/commissions.service";
import { setUserActive } from "@/services/users.service";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Fase 019.9 — histórico/timeline y auditoría. Cubre: generación de
// AuditEvent desde cada servicio auditado, diff before/after, campos
// sensibles nunca en `changes`, autorización del timeline (AGENT
// scoping + ASSISTANT sin Comisiones), paginación y orden.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdHouseholdIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdTaskIds: string[] = [];
const createdExpectationIds: string[] = [];

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

async function makePerson(actor: AuthorizedUser, assignedAgentId?: string) {
  const person = await createPerson(actor, {
    firstName: "Test",
    lastName: uniqueName("Person"),
    contactStatus: "CLIENT",
    ...(assignedAgentId ? { assignedAgentId } : {}),
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeProduct(policyType: "HEALTH" | "LIFE" = "HEALTH") {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier History") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan History"), policyType },
  });
  createdProductIds.push(product.id);
  return product;
}

async function makePolicyFor(actor: AuthorizedUser, holder: { id: string }, extra: Record<string, unknown> = {}) {
  const product = await makeProduct();
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
    ...extra,
  });
  createdPolicyIds.push(policy.id);
  return { policy, product };
}

let periodCounter = 200;
function nextPeriod(): string {
  periodCounter += 1;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + periodCounter, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-hist");
  agent = await makeActor("AGENT", "agent-hist");
  agentB = await makeActor("AGENT", "agentb-hist");
  assistant = await makeActor("ASSISTANT", "assistant-hist");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({
    where: { commissionExpectationId: { in: createdExpectationIds } },
  });
  await prisma.commissionExpectation.deleteMany({ where: { id: { in: createdExpectationIds } } });
  await prisma.commissionRule.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { contactPersonId: { in: createdPersonIds } },
        { policyId: { in: createdPolicyIds } },
        { householdId: { in: createdHouseholdIds } },
        { entityType: "User", entityId: { in: createdUserIds } },
      ],
    },
  });
  await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.personMedication.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.personProvider.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.policyDocument.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("history.service — eventos generados por cada módulo", () => {
  it("A) crear un contacto genera CONTACT_CREATE en su timeline", async () => {
    const person = await makePerson(admin);
    const page = await getContactTimeline(admin, person.id);
    expect(page.events.some((e) => e.action === "CONTACT_CREATE")).toBe(true);
  });

  it("B) actualizar un contacto captura el diff before/after", async () => {
    const person = await makePerson(admin);
    await updatePerson(admin, person.id, { phone: "555-1000" });
    const page = await getContactTimeline(admin, person.id);
    const event = page.events.find((e) => e.action === "CONTACT_UPDATE")!;
    expect(event).toBeTruthy();
    expect(event.changes).toMatchObject({ phone: { after: "555-1000" } });
  });

  it("contactStatus nunca se resetea silenciosamente en una actualización que no lo toca (bug real corregido en esta fase)", async () => {
    const person = await makePerson(admin);
    expect(person.contactStatus).toBe("CLIENT");
    const updated = await updatePerson(admin, person.id, { phone: "555-9999" });
    expect(updated.contactStatus).toBe("CLIENT");
  });

  it("C) actualizar sin cambiar nada no genera un nuevo evento de UPDATE", async () => {
    const person = await makePerson(admin, undefined);
    await updatePerson(admin, person.id, { phone: "555-2000" });
    const before = (await getContactTimeline(admin, person.id)).events.length;
    await updatePerson(admin, person.id, { phone: "555-2000" });
    const after = (await getContactTimeline(admin, person.id)).events.length;
    expect(after).toBe(before);
  });

  it("D) actualizar el hogar (dirección) genera HOUSEHOLD_UPDATE visible en el timeline del contacto", async () => {
    const person = await makePerson(admin);
    const household = await createHouseholdWithInitialMember(admin, { personId: person.id, role: "HEAD" });
    createdHouseholdIds.push(household.id);
    await updateHousehold(admin, household.id, { city: "Naperville" });

    const page = await getContactTimeline(admin, person.id);
    const event = page.events.find((e) => e.action === "HOUSEHOLD_UPDATE")!;
    expect(event).toBeTruthy();
    expect(event.changes).toMatchObject({ city: { after: "Naperville" } });
  });

  it("E) agregar un miembro al hogar genera HOUSEHOLD_ADD_MEMBER", async () => {
    const head = await makePerson(admin);
    const spouse = await makePerson(admin);
    const household = await createHouseholdWithInitialMember(admin, { personId: head.id, role: "HEAD" });
    createdHouseholdIds.push(household.id);
    await addHouseholdMember(admin, household.id, { personId: spouse.id, role: "SPOUSE" });

    const page = await getContactTimeline(admin, spouse.id);
    expect(page.events.some((e) => e.action === "HOUSEHOLD_ADD_MEMBER")).toBe(true);
  });

  it("F) crear una póliza genera POLICY_CREATE visible en el timeline del contacto", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    const page = await getContactTimeline(admin, holder.id);
    expect(page.events.some((e) => e.action === "POLICY_CREATE")).toBe(true);
    const policyPage = await getPolicyTimeline(admin, policy.id);
    expect(policyPage.events.some((e) => e.action === "POLICY_CREATE")).toBe(true);
  });

  it("G) actualizar una póliza captura el diff", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    await updatePolicy(admin, policy.id, { policyNumber: "POL-999" });
    const page = await getPolicyTimeline(admin, policy.id);
    const event = page.events.find((e) => e.action === "POLICY_UPDATE")!;
    expect(event.changes).toMatchObject({ policyNumber: { after: "POL-999" } });
  });

  it("H) cambiar el status a CANCELLED genera POLICY_CANCEL", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    await updatePolicy(admin, policy.id, { status: "CANCELLED" });
    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "POLICY_CANCEL")).toBe(true);
  });

  it("I) agregar y quitar un miembro de la póliza genera POLICY_ADD_MEMBER / POLICY_REMOVE_MEMBER", async () => {
    const holder = await makePerson(admin);
    const spouse = await makePerson(admin);
    const household = await createHouseholdWithInitialMember(admin, { personId: holder.id, role: "HEAD" });
    createdHouseholdIds.push(household.id);
    await addHouseholdMember(admin, household.id, { personId: spouse.id, role: "SPOUSE" });
    const { policy } = await makePolicyFor(admin, holder);
    const updated = await addPolicyMember(admin, policy.id, { personId: spouse.id, role: "SPOUSE" });
    const memberId = updated.members.find((m) => m.person.id === spouse.id)!.id;
    await removePolicyMember(admin, policy.id, memberId);

    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "POLICY_ADD_MEMBER")).toBe(true);
    expect(page.events.some((e) => e.action === "POLICY_REMOVE_MEMBER")).toBe(true);
  });

  it("J) vincular un hogar tardío genera POLICY_LINK_HOUSEHOLD", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    const household = await createHouseholdWithInitialMember(admin, { personId: holder.id, role: "HEAD" });
    createdHouseholdIds.push(household.id);
    await linkPolicyToHousehold(admin, policy.id, household.id);

    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "POLICY_LINK_HOUSEHOLD")).toBe(true);
  });

  it("K) actualizar información de salud audita el cambio SIN exponer incomeUsed/taxCreditAmount", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    await createHealthPolicyDetail(admin, { policyId: policy.id, planNameSnapshot: "Plan A" });
    await updateHealthPolicyDetail(admin, policy.id, {
      planNameSnapshot: "Plan B",
      incomeUsed: "70000",
      taxCreditAmount: "500",
    });

    const page = await getPolicyTimeline(admin, policy.id);
    const events = page.events.filter((e) => e.action === "HEALTH_UPDATE_HEALTH_DETAILS");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const changes = e.changes as Record<string, unknown> | null;
      expect(changes ? Object.keys(changes) : []).not.toContain("incomeUsed");
      expect(changes ? Object.keys(changes) : []).not.toContain("taxCreditAmount");
    }
  });

  it("L) medicamentos: crear/editar/eliminar audita SIN exponer name/dosage en changes", async () => {
    const person = await makePerson(admin);
    const med = await createPersonMedication(admin, { personId: person.id, name: "Metformin", dosage: "500mg" });
    await updatePersonMedication(admin, med.id, { dosage: "850mg" });
    await deletePersonMedication(admin, med.id);

    const page = await getContactTimeline(admin, person.id);
    const medEvents = page.events.filter((e) => e.entityType === "PersonMedication");
    expect(medEvents.map((e) => e.action).sort()).toEqual(
      ["MEDICATION_CREATE", "MEDICATION_DEACTIVATE", "MEDICATION_UPDATE"].sort()
    );
    for (const e of medEvents) {
      expect(e.summary).not.toContain("Metformin");
      expect(e.changes).toBeFalsy();
    }
  });

  it("M) proveedores: crear audita PROVIDER_CREATE", async () => {
    const person = await makePerson(admin);
    await createPersonProvider(admin, { personId: person.id, type: "PCP", name: "Dr. Smith" });
    const page = await getContactTimeline(admin, person.id);
    expect(page.events.some((e) => e.action === "PROVIDER_CREATE")).toBe(true);
  });

  it("N) crear y completar una tarea genera TASK_CREATE y TASK_COMPLETE", async () => {
    const person = await makePerson(admin);
    const task = await createTask(admin, { title: "Llamar", personId: person.id });
    createdTaskIds.push(task.id);
    await completeTask(admin, task.id);

    const page = await getContactTimeline(admin, person.id);
    expect(page.events.some((e) => e.action === "TASK_CREATE")).toBe(true);
    expect(page.events.some((e) => e.action === "TASK_COMPLETE")).toBe(true);
  });

  it("O) actualizar seguimiento de pago genera PREMIUM_UPDATE_TRACKING", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    await updatePremiumTracking(admin, policy.id, {
      premiumAmount: "150.00",
      autopay: "true",
      needsPaymentAssistance: "false",
    });

    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "PREMIUM_UPDATE_TRACKING")).toBe(true);
  });

  it("P) corregir manualmente una expectativa genera COMMISSION_EXPECTATION_OVERRIDE, nunca expone el monto", async () => {
    const holder = await makePerson(admin);
    const { policy, product } = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    const expectationId = (generated as { expectationId: string }).expectationId;
    createdExpectationIds.push(expectationId);
    await updateCommissionExpectation(admin, expectationId, { expectedAmount: "40.00" });

    const page = await getPolicyTimeline(admin, policy.id);
    const event = page.events.find((e) => e.action === "COMMISSION_EXPECTATION_OVERRIDE")!;
    expect(event).toBeTruthy();
    expect(JSON.stringify(event.changes ?? {})).not.toContain("40");
    expect(JSON.stringify(event.summary)).not.toContain("40");
  });

  it("Q) registrar un pago de comisión genera COMMISSION_PAYMENT; R) un chargeback genera COMMISSION_CHARGEBACK", async () => {
    const holder = await makePerson(admin);
    const { policy, product } = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "25.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    const expectationId = (generated as { expectationId: string }).expectationId;
    createdExpectationIds.push(expectationId);
    await addCommissionPayment(admin, expectationId, { type: "PAYMENT", amount: "25.00", receivedAt: new Date() });
    await addCommissionPayment(admin, expectationId, { type: "CHARGEBACK", amount: "25.00", receivedAt: new Date() });

    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "COMMISSION_PAYMENT")).toBe(true);
    expect(page.events.some((e) => e.action === "COMMISSION_CHARGEBACK")).toBe(true);
  });

  it("S) subir un documento genera DOCUMENT_UPLOAD", async () => {
    const holder = await makePerson(admin);
    const { policy } = await makePolicyFor(admin, holder);
    const { uploadPolicyDocument } = await import("@/services/policy-documents.service");
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
    const file = new File([bytes], "resumen.pdf", { type: "application/pdf" });
    await uploadPolicyDocument(admin, { policyId: policy.id, type: "PLAN_SUMMARY" }, file);

    const page = await getPolicyTimeline(admin, policy.id);
    expect(page.events.some((e) => e.action === "DOCUMENT_UPLOAD")).toBe(true);
  });

  it("T) activar/desactivar un usuario genera USER_ACTIVATE / USER_DEACTIVATE", async () => {
    const target = await makeActor("AGENT", "target-hist");
    await setUserActive(admin, { id: target.id, isActive: false });
    await setUserActive(admin, { id: target.id, isActive: true });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "User", entityId: target.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["USER_DEACTIVATE", "USER_ACTIVATE"]);
  });

  it("U) el actor real queda registrado (id y nombre visibles en el evento)", async () => {
    const person = await makePerson(admin);
    const page = await getContactTimeline(admin, person.id);
    const event = page.events.find((e) => e.action === "CONTACT_CREATE")!;
    expect(event.actor?.id).toBe(admin.id);
    expect(event.actor?.name).toBe(admin.name);
    expect(event.actorType).toBe("USER");
  });

  it("V) autoGenerateCurrentPeriodExpectation sin actor produce un evento SYSTEM", async () => {
    const { autoGenerateCurrentPeriodExpectation } = await import("@/services/commission-rules.service");
    const holder = await makePerson(admin);
    const { policy, product } = await makePolicyFor(admin, holder, {
      effectiveDate: new Date("2020-01-01"),
      status: "ACTIVE",
    });
    await createCommissionRule(admin, {
      productId: product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "10.00",
      initialPeriodicity: "MONTHLY",
    });
    await autoGenerateCurrentPeriodExpectation(policy.id);

    const events = await prisma.auditEvent.findMany({
      where: { policyId: policy.id, action: "COMMISSION_EXPECTATION_CREATE" },
    });
    for (const e of events) createdExpectationIds.push(e.entityId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].actorType).toBe("SYSTEM");
    expect(events[0].actorUserId).toBeNull();
  });
});

describe("history.service — autorización del timeline", () => {
  it("X) AGENT sin acceso a un contacto no puede ver su timeline (FORBIDDEN)", async () => {
    const person = await makePerson(admin, agentB.id);
    await expect(getContactTimeline(agent, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Y) ASSISTANT nunca ve eventos de Comisiones en el timeline de un contacto al que sí tiene acceso", async () => {
    const holder = await makePerson(admin);
    const { policy, product } = await makePolicyFor(admin, holder, { effectiveDate: new Date("2020-01-01") });
    await createCommissionRule(admin, {
      productId: product.id,
      method: "FIXED_AMOUNT",
      base: "FIXED",
      initialAmount: "10.00",
      initialPeriodicity: "MONTHLY",
    });
    const period = nextPeriod();
    const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period });
    createdExpectationIds.push((generated as { expectationId: string }).expectationId);

    const assistantPage = await getContactTimeline(assistant, holder.id);
    expect(assistantPage.events.some((e) => e.entityType === "CommissionExpectation")).toBe(false);
    const adminPage = await getContactTimeline(admin, holder.id);
    expect(adminPage.events.some((e) => e.entityType === "CommissionExpectation")).toBe(true);
  });

  it("AA) AGENT scoping: puede ver el timeline de un contacto asignado a sí mismo o sin asignar", async () => {
    const own = await makePerson(admin, agent.id);
    const unassigned = await makePerson(admin);
    await expect(getContactTimeline(agent, own.id)).resolves.toBeTruthy();
    await expect(getContactTimeline(agent, unassigned.id)).resolves.toBeTruthy();
  });
});

describe("history.service — paginación y orden", () => {
  it("Z) paginación: 'Mostrar más' devuelve eventos adicionales vía nextCursor", async () => {
    const person = await makePerson(admin);
    for (let i = 0; i < 3; i++) {
      await updatePerson(admin, person.id, { phone: `555-300${i}` });
    }
    const firstPage = await getContactTimeline(admin, person.id, { limit: 2 });
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getContactTimeline(admin, person.id, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.events.length).toBeGreaterThan(0);
    const firstIds = new Set(firstPage.events.map((e) => e.id));
    expect(secondPage.events.every((e) => !firstIds.has(e.id))).toBe(true);
  });

  it("AB) orden: eventos más recientes primero (createdAt DESC)", async () => {
    const person = await makePerson(admin);
    await updatePerson(admin, person.id, { phone: "555-4001" });
    await updatePerson(admin, person.id, { phone: "555-4002" });
    const page = await getContactTimeline(admin, person.id);
    const timestamps = page.events.map((e) => new Date(e.createdAt).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});
