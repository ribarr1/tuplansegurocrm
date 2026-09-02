import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { listClientReport } from "@/services/reports.service";
import { createPolicy } from "@/services/policies.service";
import { updateImmigrationCategory } from "@/services/sensitive-identity.service";
import { recordAuditEvent } from "@/services/audit.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 021 (§31-§38, §47) — reporte operativo de clientes.

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdHouseholdIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
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

async function makePerson(overrides: Record<string, unknown> = {}) {
  const person = await prisma.person.create({
    data: {
      firstName: uniqueName("Report"),
      lastName: uniqueName("Client"),
      contactStatus: "CLIENT",
      ...overrides,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeHouseholdFor(personId: string, overrides: Record<string, unknown> = {}) {
  const household = await prisma.household.create({ data: { ...overrides } });
  createdHouseholdIds.push(household.id);
  await prisma.householdMember.create({ data: { personId, householdId: household.id, role: "HEAD" } });
  return household;
}

async function makeCarrierAndProduct(policyType: "HEALTH" | "DENTAL" = "HEALTH") {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Product"), policyType },
  });
  createdProductIds.push(product.id);
  return { carrier, product };
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-reports");
  agent = await makeActor("AGENT", "agent-reports");
  agentB = await makeActor("AGENT", "agentb-reports");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { contactPersonId: { in: createdPersonIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.personSensitiveIdentity.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("reports.service — reporte de clientes", () => {
  it("AI) pagination respeta pageSize y page", async () => {
    const label = uniqueName("Page");
    for (let i = 0; i < 3; i++) {
      await makePerson({ firstName: label, lastName: `${label}-${i}` });
    }
    const page1 = await listClientReport(admin, { search: label, pageSize: 2, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = await listClientReport(admin, { search: label, pageSize: 2, page: 2 });
    expect(page2.items).toHaveLength(1);
  });

  it("AJ) filtro por Contact Status", async () => {
    const label = uniqueName("Status");
    await makePerson({ firstName: label, contactStatus: "PROSPECT" });
    await makePerson({ firstName: label, contactStatus: "CLIENT" });
    const result = await listClientReport(admin, { search: label, contactStatus: "PROSPECT" });
    expect(result.items.every((p) => p.contactStatus === "PROSPECT")).toBe(true);
  });

  it("AK) filtro por Agente asignado", async () => {
    const label = uniqueName("Agent");
    await makePerson({ firstName: label, assignedAgentId: agent.id });
    await makePerson({ firstName: label, assignedAgentId: agentB.id });
    const result = await listClientReport(admin, { search: label, assignedAgentId: agent.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].assignedAgent?.id).toBe(agent.id);
  });

  it("AL) filtro por State (del hogar)", async () => {
    const label = uniqueName("State");
    const p1 = await makePerson({ firstName: label });
    await makeHouseholdFor(p1.id, { state: "FL" });
    const p2 = await makePerson({ firstName: label });
    await makeHouseholdFor(p2.id, { state: "TX" });
    const result = await listClientReport(admin, { search: label, state: "FL" });
    expect(result.items.map((p) => p.id)).toEqual([p1.id]);
  });

  it("AM) filtro por categoría migratoria", async () => {
    const label = uniqueName("Imm");
    const p1 = await makePerson({ firstName: label });
    await updateImmigrationCategory(admin, { personId: p1.id, immigrationCategory: "US_CITIZEN" });
    const p2 = await makePerson({ firstName: label });
    await updateImmigrationCategory(admin, { personId: p2.id, immigrationCategory: "OTHER" });
    const result = await listClientReport(admin, { search: label, immigrationCategory: "US_CITIZEN" });
    expect(result.items.map((p) => p.id)).toEqual([p1.id]);
  });

  it("AN) filtro por Has Active Policy", async () => {
    const label = uniqueName("Active");
    const { product } = await makeCarrierAndProduct();
    const withPolicy = await makePerson({ firstName: label });
    const policy = await createPolicy(admin, {
      holderId: withPolicy.id,
      productId: product.id,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
    });
    createdPolicyIds.push(policy.id);
    const withoutPolicy = await makePerson({ firstName: label });
    const result = await listClientReport(admin, { search: label, hasActivePolicy: "true" });
    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(withPolicy.id);
    expect(ids).not.toContain(withoutPolicy.id);
  });

  it("AO) filtro por Carrier", async () => {
    const label = uniqueName("Carrier");
    const { product: productA, carrier: carrierA } = await makeCarrierAndProduct();
    const { product: productB } = await makeCarrierAndProduct();
    const personA = await makePerson({ firstName: label });
    const policyA = await createPolicy(admin, {
      holderId: personA.id,
      productId: productA.id,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
    });
    createdPolicyIds.push(policyA.id);
    const personB = await makePerson({ firstName: label });
    const policyB = await createPolicy(admin, {
      holderId: personB.id,
      productId: productB.id,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
    });
    createdPolicyIds.push(policyB.id);
    const result = await listClientReport(admin, { search: label, carrierId: carrierA.id });
    expect(result.items.map((p) => p.id)).toEqual([personA.id]);
  });

  it("AP) búsqueda por nombre", async () => {
    const label = uniqueName("SearchName");
    const person = await makePerson({ firstName: label });
    const result = await listClientReport(admin, { search: label });
    expect(result.items.map((p) => p.id)).toContain(person.id);
  });

  it("AQ) autorización: mismo criterio de visibilidad abierta que Contactos (AGENT ve contactos de otros agentes)", async () => {
    const label = uniqueName("OpenVis");
    const person = await makePerson({ firstName: label, assignedAgentId: agentB.id });
    const result = await listClientReport(agent, { search: label });
    expect(result.items.map((p) => p.id)).toContain(person.id);
  });

  it("AS) el reporte nunca incluye SSN/USCIS/A-Number/número de documento", async () => {
    const label = uniqueName("NoPii");
    const person = await makePerson({ firstName: label });
    const { setSsn } = await import("@/services/sensitive-identity.service");
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const result = await listClientReport(admin, { search: label });
    expect(JSON.stringify(result.items)).not.toContain("123456789");
    expect(JSON.stringify(result.items)).not.toContain("ssnEncrypted");
    expect(JSON.stringify(result.items)).not.toContain("uscisNumberEncrypted");
  });

  it("AU) muestra la última actividad del contacto", async () => {
    const label = uniqueName("LastAct");
    const person = await makePerson({ firstName: label });
    await recordAuditEvent(prisma, {
      actor: admin,
      entityType: "Person",
      entityId: person.id,
      action: "CONTACT_UPDATE",
      contactPersonId: person.id,
      summary: "Contacto actualizado (test)",
    });
    const result = await listClientReport(admin, { search: label });
    const row = result.items.find((p) => p.id === person.id);
    expect(row?.lastActivity?.summary).toBe("Contacto actualizado (test)");
  });

  it("AV) filtro Expiring Soon respeta la misma ventana que 'Vencen en 30 días'", async () => {
    const label = uniqueName("Expiring");
    const { product } = await makeCarrierAndProduct();
    const soonPerson = await makePerson({ firstName: label });
    const soonPolicy = await createPolicy(admin, {
      holderId: soonPerson.id,
      productId: product.id,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
      terminationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    createdPolicyIds.push(soonPolicy.id);
    const farPerson = await makePerson({ firstName: label });
    const farPolicy = await createPolicy(admin, {
      holderId: farPerson.id,
      productId: product.id,
      holderCovered: "true",
      status: "ACTIVE",
      effectiveDate: new Date("2026-01-01"),
      terminationDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });
    createdPolicyIds.push(farPolicy.id);
    const result = await listClientReport(admin, { search: label, expiringSoon: "true" });
    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(soonPerson.id);
    expect(ids).not.toContain(farPerson.id);
  });
});
