import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  setProductActive,
} from "@/services/products.service";
import { setCarrierActive } from "@/services/carriers.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPolicyIds: string[] = [];

function trackCarrier<T extends { id: string }>(c: T): T {
  createdCarrierIds.push(c.id);
  return c;
}
function trackProduct<T extends { id: string }>(p: T): T {
  createdProductIds.push(p.id);
  return p;
}
function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}
function trackPolicy<T extends { id: string }>(p: T): T {
  createdPolicyIds.push(p.id);
  return p;
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

async function makeCarrier() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Prod") } });
  return trackCarrier(carrier);
}

async function makePerson() {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
    },
  });
  return trackPerson(person);
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-prod");
  agent = await makeActor("AGENT", "agent-prod");
  assistant = await makeActor("ASSISTANT", "assistant-prod");
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("products.service", () => {
  it("I) ADMIN crea Product", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan"), policyType: "HEALTH" })
    );
    expect(product.carrier.id).toBe(carrier.id);
    expect(product.isActive).toBe(true);
  });

  it("J) Product requiere Carrier existente", async () => {
    await expect(
      createProduct(admin, {
        carrierId: "00000000-0000-4000-8000-000000000002",
        name: uniqueName("Plan huerfano"),
        policyType: "HEALTH",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("K) Product puede crearse bajo un Carrier inactivo (no puede USARSE en Policy nueva)", async () => {
    const carrier = await makeCarrier();
    await setCarrierActive(admin, carrier.id, false);
    const product = trackProduct(
      await createProduct(admin, {
        carrierId: carrier.id,
        name: uniqueName("Plan de carrier inactivo"),
        policyType: "HEALTH",
      })
    );
    expect(product.carrier.isActive).toBe(false);
  });

  it("L) Product sin uso permite editar identidad (carrierId/policyType/planYear)", async () => {
    const carrier = await makeCarrier();
    const otherCarrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan L"), policyType: "HEALTH" })
    );
    const updated = await updateProduct(admin, product.id, {
      carrierId: otherCarrier.id,
      policyType: "DENTAL",
      planYear: "2027",
    });
    expect(updated.carrier.id).toBe(otherCarrier.id);
    expect(updated.policyType).toBe("DENTAL");
    expect(updated.planYear).toBe(2027);
  });

  it("M) Product usado por Policy bloquea carrierId/policyType/planYear", async () => {
    const carrier = await makeCarrier();
    const otherCarrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan M"), policyType: "HEALTH" })
    );
    const holder = await makePerson();
    trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );

    await expect(updateProduct(admin, product.id, { carrierId: otherCarrier.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updateProduct(admin, product.id, { policyType: "DENTAL" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updateProduct(admin, product.id, { planYear: "2030" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    // name/externalCode sí siguen editables tras el uso.
    const updated = await updateProduct(admin, product.id, { name: uniqueName("Plan M corregido") });
    expect(updated.name).toContain("Plan M corregido");
  });

  it("N) Product usado puede desactivarse", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan N"), policyType: "HEALTH" })
    );
    const holder = await makePerson();
    trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );

    const updated = await setProductActive(admin, product.id, false);
    expect(updated.isActive).toBe(false);
  });

  it("O) Product inactivo no puede usarse para crear Policy", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan O"), policyType: "HEALTH" })
    );
    await setProductActive(admin, product.id, false);
    const holder = await makePerson();

    await expect(
      createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("P) listProducts filtra por Carrier", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan P"), policyType: "HEALTH" })
    );
    const { items } = await listProducts(admin, { carrierId: carrier.id });
    expect(items.map((p) => p.id)).toEqual([product.id]);
  });

  it("Q) filtra por PolicyType", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan Q"), policyType: "DENTAL" })
    );
    const { items } = await listProducts(admin, { carrierId: carrier.id, policyType: "DENTAL" });
    expect(items.map((p) => p.id)).toContain(product.id);
    const { items: healthItems } = await listProducts(admin, { carrierId: carrier.id, policyType: "HEALTH" });
    expect(healthItems.map((p) => p.id)).not.toContain(product.id);
  });

  it("R) filtra active/inactive", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan R"), policyType: "HEALTH" })
    );
    await setProductActive(admin, product.id, false);

    const { items: activeItems } = await listProducts(admin, { carrierId: carrier.id, active: "true" });
    expect(activeItems.map((p) => p.id)).not.toContain(product.id);
    const { items: inactiveItems } = await listProducts(admin, { carrierId: carrier.id, active: "false" });
    expect(inactiveItems.map((p) => p.id)).toContain(product.id);
  });

  it("S) AGENT/ASSISTANT pueden consultar catálogos, pero no mutarlos", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan S"), policyType: "HEALTH" })
    );

    const forAgent = await getProductById(agent, product.id);
    expect(forAgent.id).toBe(product.id);
    const forAssistant = await listProducts(assistant, { carrierId: carrier.id });
    expect(forAssistant.items.map((p) => p.id)).toContain(product.id);

    await expect(
      createProduct(agent, { carrierId: carrier.id, name: uniqueName("Plan S2"), policyType: "HEALTH" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProduct(assistant, product.id, { name: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  // T) "usuario inactive bloqueado": misma razón documentada en
  // households.service.test.ts / policies.service.test.ts — cada
  // función recibe un actor: AuthorizedUser ya resuelto por
  // requireSessionUser()/requireSessionRole(), que rechaza usuarios
  // inactivos (probado en src/lib/authorization.test.ts). No hay una
  // ruta de código nueva que probar aquí.

  it("G) Product histórico de un Carrier desactivado sigue consultable", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan G"), policyType: "HEALTH" })
    );
    const holder = await makePerson();
    trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    );

    await setCarrierActive(admin, carrier.id, false);

    const fetched = await getProductById(admin, product.id);
    expect(fetched.id).toBe(product.id);
    expect(fetched.carrier.isActive).toBe(false);
  });

  it("H) nueva Policy con Product cuyo Carrier está inactivo falla", async () => {
    const carrier = await makeCarrier();
    const product = trackProduct(
      await createProduct(admin, { carrierId: carrier.id, name: uniqueName("Plan H"), policyType: "HEALTH" })
    );
    await setCarrierActive(admin, carrier.id, false);
    const holder = await makePerson();

    await expect(
      createPolicy(admin, { holderId: holder.id, productId: product.id, holderCovered: "false" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // Fase 022 (Hallazgo #5 de UAT): productos duplicados.
  describe("Hallazgo #5 — prevención de productos duplicados", () => {
    it("rechaza el mismo nombre exacto para el mismo carrier/tipo/año", async () => {
      const carrier = await makeCarrier();
      const name = uniqueName("Aetna Copagos 100");
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name, policyType: "HEALTH", planYear: 2026 })
      );
      await expect(
        createProduct(admin, { carrierId: carrier.id, name, policyType: "HEALTH", planYear: 2026 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rechaza un duplicado normalizado (mayúsculas/espacios distintos, mismo nombre real)", async () => {
      const carrier = await makeCarrier();
      const base = uniqueName("aetna copagos 100");
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name: base, policyType: "HEALTH", planYear: 2026 })
      );
      const variant = `  ${base.toUpperCase()}  `.replace(/(\s)\s+/g, "$1"); // espacios de más + mayúsculas
      await expect(
        createProduct(admin, { carrierId: carrier.id, name: variant, policyType: "HEALTH", planYear: 2026 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("permite el mismo nombre en un carrier DISTINTO", async () => {
      const carrierA = await makeCarrier();
      const carrierB = await makeCarrier();
      const name = uniqueName("Mismo Nombre");
      trackProduct(
        await createProduct(admin, { carrierId: carrierA.id, name, policyType: "HEALTH", planYear: 2026 })
      );
      trackProduct(
        await createProduct(admin, { carrierId: carrierB.id, name, policyType: "HEALTH", planYear: 2026 })
      );
    });

    it("permite el mismo producto en un año DISTINTO", async () => {
      const carrier = await makeCarrier();
      const name = uniqueName("Plan Anual");
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name, policyType: "HEALTH", planYear: 2026 })
      );
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name, policyType: "HEALTH", planYear: 2027 })
      );
    });

    it("permite el mismo nombre con un tipo de seguro DISTINTO", async () => {
      const carrier = await makeCarrier();
      const name = uniqueName("Plan Combinado");
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name, policyType: "HEALTH", planYear: 2026 })
      );
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name, policyType: "DENTAL", planYear: 2026 })
      );
    });

    it("updateProduct también rechaza renombrar hacia un duplicado ya existente", async () => {
      const carrier = await makeCarrier();
      const nameA = uniqueName("Plan Original A");
      const nameB = uniqueName("Plan Original B");
      trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name: nameA, policyType: "HEALTH", planYear: 2026 })
      );
      const productB = trackProduct(
        await createProduct(admin, { carrierId: carrier.id, name: nameB, policyType: "HEALTH", planYear: 2026 })
      );
      await expect(updateProduct(admin, productB.id, { name: nameA })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("updateProduct permite renombrar el producto a un nombre no usado por nadie más", async () => {
      const carrier = await makeCarrier();
      const product = trackProduct(
        await createProduct(admin, {
          carrierId: carrier.id,
          name: uniqueName("Plan Antiguo"),
          policyType: "HEALTH",
          planYear: 2026,
        })
      );
      const updated = await updateProduct(admin, product.id, { name: uniqueName("Plan Renombrado") });
      expect(updated.name).toContain("Plan Renombrado");
    });
  });
});
