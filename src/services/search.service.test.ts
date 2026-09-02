import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { globalSearch } from "@/services/search.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 019.9 (§6, §26) — buscador global: Contactos por nombre/
// teléfono/email, Pólizas por policyNumber, autorización.

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
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
      firstName: "Search",
      lastName: uniqueName("Target"),
      contactStatus: "CLIENT",
      ...overrides,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let activeProductId: string;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-search");
  agent = await makeActor("AGENT", "agent-search");
  agentB = await makeActor("AGENT", "agentb-search");

  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Search") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Search"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  activeProductId = product.id;
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("search.service — buscador global", () => {
  it("encuentra un contacto por nombre", async () => {
    const person = await makePerson({ firstName: "Ramona" });
    const results = await globalSearch(admin, { q: "Ramona" });
    expect(results.contacts.some((c) => c.id === person.id)).toBe(true);
  });

  it("encuentra un contacto por teléfono", async () => {
    const person = await makePerson({ phone: uniqueName("555") });
    const results = await globalSearch(admin, { q: person.phone! });
    expect(results.contacts.some((c) => c.id === person.id)).toBe(true);
  });

  it("encuentra un contacto por email", async () => {
    const email = `${uniqueName("search")}@example.com`;
    const person = await makePerson({ email });
    const results = await globalSearch(admin, { q: email });
    expect(results.contacts.some((c) => c.id === person.id)).toBe(true);
  });

  it("encuentra una póliza por policyNumber", async () => {
    const holder = await makePerson();
    const policyNumber = uniqueName("POL");
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: activeProductId,
      holderCovered: "false",
      policyNumber,
    });
    createdPolicyIds.push(policy.id);

    const results = await globalSearch(admin, { q: policyNumber });
    expect(results.policies.some((p) => p.id === policy.id)).toBe(true);
  });

  it("autorización de pólizas: AGENT sin acceso no ve una póliza fuera de su cartera", async () => {
    const holder = await makePerson({ assignedAgentId: agentB.id });
    const policyNumber = uniqueName("POLSCOPED");
    const policy = await createPolicy(admin, {
      holderId: holder.id,
      productId: activeProductId,
      holderCovered: "false",
      policyNumber,
    });
    createdPolicyIds.push(policy.id);

    const asAgent = await globalSearch(agent, { q: policyNumber });
    expect(asAgent.policies.some((p) => p.id === policy.id)).toBe(false);

    const asAdmin = await globalSearch(admin, { q: policyNumber });
    expect(asAdmin.policies.some((p) => p.id === policy.id)).toBe(true);
  });

  it("query vacío se rechaza con VALIDATION_ERROR", async () => {
    await expect(globalSearch(admin, { q: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("nunca revienta con caracteres especiales en la búsqueda", async () => {
    await expect(globalSearch(admin, { q: "%_'\"--" })).resolves.toBeTruthy();
  });
});
