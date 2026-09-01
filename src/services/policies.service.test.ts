import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listPolicies,
  getPolicyById,
  getPoliciesForPerson,
  createPolicy,
  updatePolicy,
} from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPolicyIds: string[] = [];
let carrierId: string;
let activeProductId: string;
let inactiveProductId: string;

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

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  return trackPerson(person);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-pol");
  agent = await makeActor("AGENT", "agent-pol");
  agentB = await makeActor("AGENT", "agentb-pol");
  assistant = await makeActor("ASSISTANT", "assistant-pol");

  const carrier = await prisma.carrier.create({
    data: { name: `Test Carrier ${Date.now()}`, isActive: true },
  });
  carrierId = carrier.id;

  const activeProduct = await prisma.product.create({
    data: { carrierId, name: "Plan Activo Test", policyType: "HEALTH", isActive: true },
  });
  activeProductId = activeProduct.id;

  const inactiveProduct = await prisma.product.create({
    data: { carrierId, name: "Plan Inactivo Test", policyType: "HEALTH", isActive: false },
  });
  inactiveProductId = inactiveProduct.id;
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { carrierId } });
  await prisma.carrier.deleteMany({ where: { id: carrierId } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("policies.service", () => {
  it("A) crear PENDING sin effectiveDate funciona", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "PENDING",
      })
    );
    expect(policy.status).toBe("PENDING");
    expect(policy.effectiveDate).toBeNull();
  });

  it("B) crear ACTIVE sin effectiveDate falla", async () => {
    const holder = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "ACTIVE",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("C) crear ACTIVE con effectiveDate funciona", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "ACTIVE",
        effectiveDate: new Date("2026-01-01"),
      })
    );
    expect(policy.status).toBe("ACTIVE");
    expect(policy.effectiveDate).not.toBeNull();
  });

  it("D) holder cubierto genera PRIMARY", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
      })
    );
    expect(policy.members).toHaveLength(1);
    expect(policy.members[0].role).toBe("PRIMARY");
    expect(policy.members[0].person.id).toBe(holder.id);
  });

  it("E) holder no cubierto no genera PRIMARY", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    expect(policy.members).toHaveLength(0);
  });

  it("F) holder no cubierto + miembros cubiertos funciona", async () => {
    const holder = await makePerson();
    const memberB = await makePerson();
    const memberC = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        coveredMembers: [
          { personId: memberB.id, role: "SPOUSE" },
          { personId: memberC.id, role: "DEPENDENT" },
        ],
      })
    );
    expect(policy.members).toHaveLength(2);
    expect(policy.members.some((m) => m.role === "PRIMARY")).toBe(false);
  });

  it("G) role PRIMARY en un covered member es rechazado", async () => {
    const holder = await makePerson();
    const member = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        coveredMembers: [{ personId: member.id, role: "PRIMARY" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("H) member duplicado rechazado", async () => {
    const holder = await makePerson();
    const member = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        coveredMembers: [
          { personId: member.id, role: "SPOUSE" },
          { personId: member.id, role: "DEPENDENT" },
        ],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("I) productId inexistente falla", async () => {
    const holder = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: "00000000-0000-0000-0000-000000000000",
        holderCovered: "false",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("J) Product inactive no puede usarse para nueva Policy", async () => {
    const holder = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: inactiveProductId,
        holderCovered: "false",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("K) AGENT crea dentro de su acceso (propio o sin asignar)", async () => {
    const holder = await makePerson(agent.id);
    const policy = trackPolicy(
      await createPolicy(agent, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    expect(policy.holder.id).toBe(holder.id);
  });

  it("L) AGENT bloqueado fuera de su acceso", async () => {
    const holder = await makePerson(agentB.id);
    await expect(
      createPolicy(agent, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("M) ASSISTANT crea sin restricción de asignación", async () => {
    const holder = await makePerson(agentB.id);
    const policy = trackPolicy(
      await createPolicy(assistant, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    expect(policy.holder.id).toBe(holder.id);
  });

  it("N) transacción revierte por completo si falla un PolicyMember", async () => {
    const holder = await makePerson();
    const fakePersonId = "00000000-0000-4000-8000-000000000099";

    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        coveredMembers: [{ personId: fakePersonId, role: "SPOUSE" }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const orphanPolicies = await prisma.policy.findMany({ where: { holderId: holder.id } });
    expect(orphanPolicies).toHaveLength(0);
  });

  it("O) getPoliciesForPerson devuelve pólizas donde la persona es titular", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    const result = await getPoliciesForPerson(admin, holder.id);
    expect(result.map((p) => p.id)).toContain(policy.id);
  });

  it("P) getPoliciesForPerson devuelve pólizas donde la persona es miembro cubierto", async () => {
    const holder = await makePerson();
    const member = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        coveredMembers: [{ personId: member.id, role: "SPOUSE" }],
      })
    );
    const result = await getPoliciesForPerson(admin, member.id);
    expect(result.map((p) => p.id)).toContain(policy.id);
  });

  it("Q) titular + cubierto en la misma póliza no la duplica", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
      })
    );
    const result = await getPoliciesForPerson(admin, holder.id);
    const matches = result.filter((p) => p.id === policy.id);
    expect(matches).toHaveLength(1);
  });

  it("R) list search por policyNumber", async () => {
    const holder = await makePerson();
    const uniqueNumber = `POL-${Date.now()}`;
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        policyNumber: uniqueNumber,
      })
    );
    const { items } = await listPolicies(admin, { search: uniqueNumber });
    expect(items.map((p) => p.id)).toEqual([policy.id]);
  });

  it("S) filter status", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "ACTIVE",
        effectiveDate: new Date("2026-01-01"),
      })
    );
    const { items } = await listPolicies(admin, { status: "ACTIVE" });
    expect(items.map((p) => p.id)).toContain(policy.id);
  });

  it("T) filter policyType", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    const { items } = await listPolicies(admin, { policyType: "HEALTH" });
    expect(items.map((p) => p.id)).toContain(policy.id);
    const { items: lifeItems } = await listPolicies(admin, { policyType: "LIFE" });
    expect(lifeItems.map((p) => p.id)).not.toContain(policy.id);
  });

  it("U) filter carrier", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
      })
    );
    const { items } = await listPolicies(admin, { carrierId });
    expect(items.map((p) => p.id)).toContain(policy.id);
  });

  // V) "usuario inactive bloqueado": misma razón documentada en
  // households.service.test.ts — cada función de policies.service.ts
  // recibe actor: AuthorizedUser ya resuelto por
  // requireSessionUser()/requireSessionRole(), que ya rechazan usuarios
  // con isActive=false (probado en src/lib/authorization.test.ts). No
  // hay una ruta de código nueva que probar aquí.

  it("W) consultas básicas no cargan HealthPolicyDetail ni datos médicos", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
      })
    );
    const fetched = await getPolicyById(admin, policy.id);
    const keys = Object.keys(fetched);
    for (const forbidden of ["healthDetail", "commissionExpectations", "tasks", "notes"]) {
      expect(keys).not.toContain(forbidden);
    }
    const memberPersonKeys = Object.keys(fetched.members[0]?.person ?? fetched.holder);
    for (const forbidden of ["dateOfBirth", "personProvider", "personMedication", "email", "phone"]) {
      expect(memberPersonKeys).not.toContain(forbidden);
    }
  });

  it("edición: solo PENDING permite cambiar productId", async () => {
    const holder = await makePerson();
    const pending = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "PENDING",
      })
    );
    const newProduct = await prisma.product.create({
      data: { carrierId, name: "Plan Alterno Test", policyType: "HEALTH", isActive: true },
    });
    const updated = await updatePolicy(admin, pending.id, { productId: newProduct.id });
    expect(updated.product.id).toBe(newProduct.id);

    const active = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        status: "ACTIVE",
        effectiveDate: new Date("2026-01-01"),
      })
    );
    await expect(updatePolicy(admin, active.id, { productId: newProduct.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    // newProduct se limpia en afterAll (deleteMany por carrierId), después
    // de borrar las pólizas que lo referencian — borrarlo aquí fallaría
    // por el FK Restrict mientras "pending" todavía lo referencia.
  });

  // Fase 019.5 — regresión: un <select> sin cambiar en /policies?status=
  // enviaba "" antes de tener z.preprocess(emptyStringToUndefined, ...)
  // en status/policyType, lo que producía VALIDATION_ERROR.
  it("filtros vacíos de /policies no fallan (status/policyType/carrierId)", async () => {
    await expect(
      listPolicies(admin, { status: "", policyType: "", carrierId: "" })
    ).resolves.toBeDefined();
  });

  it("E) terminationDate anterior a effectiveDate se rechaza al crear", async () => {
    const holder = await makePerson();
    await expect(
      createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        effectiveDate: new Date("2026-06-01"),
        terminationDate: new Date("2026-05-01"),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("F) terminationDate anterior a effectiveDate se rechaza al actualizar", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        effectiveDate: new Date("2026-06-01"),
      })
    );
    await expect(
      updatePolicy(admin, policy.id, { terminationDate: new Date("2026-01-01") })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("M) Health Marketplace se guarda correctamente", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        healthCoverageSource: "MARKETPLACE",
      })
    );
    expect(policy.healthCoverageSource).toBe("MARKETPLACE");
  });

  it("N) Health Private se guarda correctamente", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        healthCoverageSource: "PRIVATE",
      })
    );
    expect(policy.healthCoverageSource).toBe("PRIVATE");
  });

  it("O) healthCoverageSource se rechaza al actualizar una póliza no-HEALTH", async () => {
    const nonHealthProduct = await prisma.product.create({
      data: { carrierId, name: "Plan Vida Test", policyType: "LIFE", isActive: true },
    });
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: nonHealthProduct.id, holderCovered: "false" })
    );
    await expect(
      updatePolicy(admin, policy.id, { healthCoverageSource: "MARKETPLACE" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("filtro /policies?healthSource= funciona", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        healthCoverageSource: "MARKETPLACE",
      })
    );
    const { items } = await listPolicies(admin, { healthSource: "MARKETPLACE", pageSize: 100 });
    expect(items.some((i) => i.id === policy.id)).toBe(true);
  });

  it("G) effectiveDate === terminationDate es válido", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "false",
        effectiveDate: new Date("2026-06-01"),
        terminationDate: new Date("2026-06-01"),
      })
    );
    expect(policy.terminationDate?.getTime()).toBe(policy.effectiveDate?.getTime());
  });
});
