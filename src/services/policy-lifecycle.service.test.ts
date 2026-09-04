import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { reconcilePolicyLifecycle } from "@/services/policy-lifecycle.service";

// Fase 025 (Hallazgo #5 de UAT, Parte E) — reconciliación automática
// del ciclo de vida de pólizas. Las pólizas de estos tests se crean
// directamente vía prisma (no createPolicy) porque necesitamos fechas
// PENDING/ACTIVE arbitrarias en el pasado que el flujo normal de
// creación no necesariamente permitiría sin pasos intermedios.

const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makePerson() {
  const person = await prisma.person.create({
    data: {
      firstName: "Lifecycle",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "PROSPECT",
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeProduct() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Lifecycle") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Lifecycle"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  return product;
}

async function makeRawPolicy(data: {
  holderId: string;
  productId: string;
  status: "PENDING" | "ACTIVE" | "CANCELLED" | "EXPIRED";
  effectiveDate?: Date | null;
  terminationDate?: Date | null;
  holderCovered?: boolean;
}) {
  const policy = await prisma.policy.create({
    data: {
      holderId: data.holderId,
      productId: data.productId,
      status: data.status,
      effectiveDate: data.effectiveDate ?? null,
      terminationDate: data.terminationDate ?? null,
    },
  });
  createdPolicyIds.push(policy.id);
  if (data.holderCovered) {
    await prisma.policyMember.create({
      data: { policyId: policy.id, personId: data.holderId, role: "PRIMARY" },
    });
  }
  return policy;
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
});

describe("policy-lifecycle.service", () => {
  it("A) PENDING con effectiveDate <= businessDate se activa (PENDING -> ACTIVE)", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "PENDING",
      effectiveDate: new Date(Date.UTC(2026, 5, 1)),
      holderCovered: true,
    });

    const result = await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    expect(result.activatedCount).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("ACTIVE");
  });

  it("B) PENDING con effectiveDate futura NO se activa", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "PENDING",
      effectiveDate: new Date(Date.UTC(2027, 0, 1)),
    });

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("PENDING");
  });

  it("C) ACTIVE con terminationDate < businessDate expira (ACTIVE -> EXPIRED)", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "ACTIVE",
      effectiveDate: new Date(Date.UTC(2026, 0, 1)),
      terminationDate: new Date(Date.UTC(2026, 11, 31)),
    });

    // El 31/12 mismo sigue ACTIVE.
    await reconcilePolicyLifecycle({ year: 2026, month: 11, day: 31 });
    let reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("ACTIVE");

    // A partir del 1/1 siguiente, EXPIRED.
    const result = await reconcilePolicyLifecycle({ year: 2027, month: 1, day: 1 });
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);
    reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("EXPIRED");
  });

  it("D) CANCELLED nunca se toca (nunca se reactiva ni se re-expira)", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "CANCELLED",
      effectiveDate: new Date(Date.UTC(2025, 0, 1)),
      terminationDate: new Date(Date.UTC(2025, 5, 1)),
    });

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("CANCELLED");
  });

  it("E) EXPIRED nunca se reactiva aunque effectiveDate ya haya pasado", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "EXPIRED",
      effectiveDate: new Date(Date.UTC(2025, 0, 1)),
      terminationDate: new Date(Date.UTC(2025, 11, 31)),
    });

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const reloaded = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(reloaded.status).toBe("EXPIRED");
  });

  it("F) genera AuditEvent con actor SYSTEM (actorUserId null, actorType SYSTEM)", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "PENDING",
      effectiveDate: new Date(Date.UTC(2026, 5, 1)),
    });

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const events = await prisma.auditEvent.findMany({
      where: { policyId: policy.id, action: "POLICY_AUTO_ACTIVATED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("SYSTEM");
    expect(events[0].actorUserId).toBeNull();
  });

  it("G) idempotente: correr dos veces el mismo businessDate no duplica AuditEvents", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    const policy = await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "PENDING",
      effectiveDate: new Date(Date.UTC(2026, 5, 1)),
    });

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const secondRun = await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    expect(secondRun.activatedCount).toBe(0);

    const events = await prisma.auditEvent.findMany({
      where: { policyId: policy.id, action: "POLICY_AUTO_ACTIVATED" },
    });
    expect(events).toHaveLength(1);
  });

  it("H) activar una póliza recomputa Prospecto/Cliente del titular cubierto", async () => {
    const holder = await makePerson();
    const product = await makeProduct();
    await makeRawPolicy({
      holderId: holder.id,
      productId: product.id,
      status: "PENDING",
      effectiveDate: new Date(Date.UTC(2026, 5, 1)),
      holderCovered: true,
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: holder.id } })).contactStatus).toBe(
      "PROSPECT"
    );

    await reconcilePolicyLifecycle({ year: 2026, month: 6, day: 1 });
    const reloaded = await prisma.person.findUniqueOrThrow({ where: { id: holder.id } });
    expect(reloaded.contactStatus).toBe("CLIENT");
  });
});
