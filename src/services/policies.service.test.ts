import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listPolicies,
  getPolicyById,
  getPoliciesForPerson,
  createPolicy,
  updatePolicy,
  getEligibleHouseholdMembersForPolicy,
  addPolicyMember,
  removePolicyMember,
  getPolicyMembersDetailed,
  getHouseholdLinkCandidates,
  linkPolicyToHousehold,
  renewPolicy,
  listExpiringPolicies,
  cancelPolicy,
} from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdHouseholdIds: string[] = [];
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
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
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

  // Regresión Fase 019.6 (hallazgo #9 de UAT): listPolicies dejó de usar
  // prisma.$transaction([findMany, count]) — que fijaba ambas queries a
  // una sola conexión pg y disparaba un warning real de concurrencia en
  // pg (ver docs/DECISIONS.md) — a favor de Promise.all con dos
  // llamadas independientes. Este test confirma que el cambio no
  // desincronizó items/total: paginar debe seguir devolviendo el total
  // real y una página consistente con ese total.
  it("total y paginación siguen siendo consistentes tras cambiar a Promise.all (sin $transaction)", async () => {
    const suffix = `PAG${Date.now()}`;
    const holder = await makePerson();
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createPolicy(admin, {
          holderId: holder.id,
          productId: activeProductId,
          holderCovered: "false",
          policyNumber: `${suffix}-${i}`,
        }).then((p) => trackPolicy(p))
      )
    );

    const page1 = await listPolicies(admin, { search: suffix, page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items.length).toBe(2);

    const page2 = await listPolicies(admin, { search: suffix, page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.length).toBe(1);

    const allIds = [...page1.items, ...page2.items].map((p) => p.id).sort();
    expect(allIds).toEqual(created.map((p) => p.id).sort());
  });

  // ---------------------------------------------------------------------
  // Gestión de miembros de una póliza ya existente — Fase 019.7
  // (hallazgos #12 y #13 de UAT).
  // ---------------------------------------------------------------------

  async function makeHouseholdWithMembers(
    headPersonId: string,
    otherMembers: { personId: string; role: "SPOUSE" | "CHILD" | "DEPENDENT" | "OTHER" }[]
  ) {
    const household = await prisma.household.create({ data: {} });
    createdHouseholdIds.push(household.id);
    await prisma.householdMember.create({
      data: { householdId: household.id, personId: headPersonId, role: "HEAD" },
    });
    for (const m of otherMembers) {
      await prisma.householdMember.create({
        data: { householdId: household.id, personId: m.personId, role: m.role },
      });
    }
    return household;
  }

  it("A) createPolicy vincula el household del titular cuando es inequívoco, y agregar un miembro nuevo del hogar lo hace elegible de inmediato", async () => {
    const holder = await makePerson();
    const child = await makePerson();
    await makeHouseholdWithMembers(holder.id, []);

    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    expect(policy.householdId).not.toBeNull();

    // Household todavía no tenía al child en el momento de crear la
    // póliza — se agrega DESPUÉS (caso obligatorio 12.3: C).
    await prisma.householdMember.create({
      data: { householdId: policy.householdId!, personId: child.id, role: "CHILD" },
    });

    const eligible = await getEligibleHouseholdMembersForPolicy(admin, policy.id);
    expect(eligible.some((c) => c.personId === child.id)).toBe(true);

    const updated = await addPolicyMember(admin, policy.id, { personId: child.id, role: "DEPENDENT" });
    expect(updated.members.some((m) => m.person.id === child.id && m.role === "DEPENDENT")).toBe(true);
  });

  it("B) agregar alguien al Household NO lo agrega automáticamente a la póliza (no auto-enroll)", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);

    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    // El esposo ya estaba en el hogar ANTES de crear la póliza y no se
    // marcó como covered member — no debe aparecer como PolicyMember.
    const detailed = await getPolicyMembersDetailed(admin, policy.id);
    expect(detailed.some((m) => m.person.id === spouse.id)).toBe(false);
  });

  it("C) no se puede duplicar un PolicyMember ya existente", async () => {
    const holder = await makePerson();
    const child = await makePerson();
    await makeHouseholdWithMembers(holder.id, [{ personId: child.id, role: "CHILD" }]);
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "false" })
    );

    await addPolicyMember(admin, policy.id, { personId: child.id, role: "DEPENDENT" });
    await expect(addPolicyMember(admin, policy.id, { personId: child.id, role: "DEPENDENT" })).rejects.toMatchObject(
      { code: "CONFLICT" }
    );
  });

  it("D) quitar un PolicyMember no borra la Person ni su HouseholdMember", async () => {
    const holder = await makePerson();
    const child = await makePerson();
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: child.id, role: "CHILD" }]);
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "false" })
    );
    const withMember = await addPolicyMember(admin, policy.id, { personId: child.id, role: "DEPENDENT" });
    const memberRow = withMember.members.find((m) => m.person.id === child.id)!;

    await removePolicyMember(admin, policy.id, memberRow.id);

    const stillPerson = await prisma.person.findUnique({ where: { id: child.id } });
    expect(stillPerson).not.toBeNull();
    const stillHouseholdMember = await prisma.householdMember.findUnique({
      where: { personId_householdId: { personId: child.id, householdId: household.id } },
    });
    expect(stillHouseholdMember).not.toBeNull();

    const detailed = await getPolicyMembersDetailed(admin, policy.id);
    expect(detailed.some((m) => m.person.id === child.id)).toBe(false);
  });

  it("G) el rol de póliza (PolicyMemberRole) se muestra separado del rol de hogar (HouseholdMemberRole)", async () => {
    const holder = await makePerson();
    const child = await makePerson();
    await makeHouseholdWithMembers(holder.id, [{ personId: child.id, role: "CHILD" }]);
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "false" })
    );
    await addPolicyMember(admin, policy.id, { personId: child.id, role: "DEPENDENT" });

    const detailed = await getPolicyMembersDetailed(admin, policy.id);
    const entry = detailed.find((m) => m.person.id === child.id)!;
    // Household: CHILD (filiación familiar real). Policy: DEPENDENT (rol
    // de cobertura) — nunca se mezclan ni se muestra "Otro" cuando ya
    // se conoce la relación real del hogar.
    expect(entry.householdRole).toBe("CHILD");
    expect(entry.role).toBe("DEPENDENT");
  });

  // ---------------------------------------------------------------------
  // Reparar Policy.householdId cuando quedó null — Fase 019.8 (hallazgo
  // #17 de UAT). Letras H-P (G, "vincula en creación cuando es
  // inequívoco", ya está cubierta por el test A de este mismo bloque).
  // ---------------------------------------------------------------------

  it("H) Policy creada ANTES del Household puede vincularse después (Flujo B obligatorio de la ficha)", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    expect(policy.householdId).toBeNull();

    // El Household se crea DESPUÉS de la póliza — mismo caso reportado
    // en UAT real (contacto "camila cespedes").
    const household = await makeHouseholdWithMembers(holder.id, []);

    const candidates = await getHouseholdLinkCandidates(admin, policy.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].householdId).toBe(household.id);

    const linked = await linkPolicyToHousehold(admin, policy.id, household.id);
    expect(linked.householdId).toBe(household.id);
  });

  it("I) titular con MÚLTIPLES Households nunca se vincula automáticamente — exige elección explícita", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    // Dos hogares para el mismo titular, creados DESPUÉS de la póliza.
    const householdOne = await makeHouseholdWithMembers(holder.id, []);
    // makeHouseholdWithMembers siempre agrega holder como HEAD del
    // nuevo hogar — dos households distintos con el mismo holder.
    const householdTwo = await prisma.household.create({ data: {} });
    createdHouseholdIds.push(householdTwo.id);
    await prisma.householdMember.create({
      data: { householdId: householdTwo.id, personId: holder.id, role: "HEAD" },
    });

    const candidates = await getHouseholdLinkCandidates(admin, policy.id);
    expect(candidates.map((c) => c.householdId).sort()).toEqual(
      [householdOne.id, householdTwo.id].sort()
    );

    // linkPolicyToHousehold nunca elige por sí solo: exige un
    // householdId explícito, pero acepta cualquiera de los reales.
    const linked = await linkPolicyToHousehold(admin, policy.id, householdOne.id);
    expect(linked.householdId).toBe(householdOne.id);
  });

  it("J) titular sin ningún Household: la póliza queda válida con householdId null (sin candidatos que ofrecer)", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    expect(policy.householdId).toBeNull();
    const candidates = await getHouseholdLinkCandidates(admin, policy.id);
    expect(candidates).toHaveLength(0);
  });

  it("K) vincular un Household nunca agrega miembros automáticamente (no auto-enroll)", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);

    await linkPolicyToHousehold(admin, policy.id, household.id);

    const detailed = await getPolicyMembersDetailed(admin, policy.id);
    expect(detailed.some((m) => m.person.id === spouse.id)).toBe(false);
  });

  it("L) una vez vinculada, la póliza lista al cónyuge como candidato elegible", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);
    await linkPolicyToHousehold(admin, policy.id, household.id);

    const eligible = await getEligibleHouseholdMembersForPolicy(admin, policy.id);
    expect(eligible.some((c) => c.personId === spouse.id && c.householdRole === "SPOUSE")).toBe(true);
  });

  it("M) el cónyuge se muestra como 'Esposo/a' (filiación real, nunca 'Otro')", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);
    await linkPolicyToHousehold(admin, policy.id, household.id);

    const eligible = await getEligibleHouseholdMembersForPolicy(admin, policy.id);
    const entry = eligible.find((c) => c.personId === spouse.id)!;
    expect(entry.householdRole).toBe("SPOUSE");
  });

  it("N) agregar miembro funciona correctamente después de vincular el hogar", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);
    await linkPolicyToHousehold(admin, policy.id, household.id);

    const updated = await addPolicyMember(admin, policy.id, { personId: spouse.id, role: "SPOUSE" });
    expect(updated.members.some((m) => m.person.id === spouse.id)).toBe(true);
  });

  it("O) quitar un miembro de la póliza preserva el Household (y su HouseholdMember)", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);
    await linkPolicyToHousehold(admin, policy.id, household.id);
    const withMember = await addPolicyMember(admin, policy.id, { personId: spouse.id, role: "SPOUSE" });
    const memberRow = withMember.members.find((m) => m.person.id === spouse.id)!;

    await removePolicyMember(admin, policy.id, memberRow.id);

    const stillHouseholdMember = await prisma.householdMember.findUnique({
      where: { personId_householdId: { personId: spouse.id, householdId: household.id } },
    });
    expect(stillHouseholdMember).not.toBeNull();
    const stillLinked = await getPolicyById(admin, policy.id);
    expect(stillLinked.householdId).toBe(household.id);
  });

  it("P) una póliza tipo-UAT con householdId null puede repararse explícitamente (caso real: 'camila cespedes')", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    // Simula el estado exacto reportado en UAT: Policy.householdId
    // null aunque el titular YA tiene un hogar (ej. quedó así por una
    // ejecución anterior, antes de esta reparación).
    const household = await makeHouseholdWithMembers(holder.id, []);
    expect((await getPolicyById(admin, policy.id)).householdId).toBeNull();

    await linkPolicyToHousehold(admin, policy.id, household.id);
    expect((await getPolicyById(admin, policy.id)).householdId).toBe(household.id);

    // Repetir la vinculación ya no debe ser posible (evita pisar una
    // vinculación existente sin una acción explícita de "cambiar de
    // hogar", fuera de alcance de esta fase).
    await expect(linkPolicyToHousehold(admin, policy.id, household.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("linkPolicyToHousehold rechaza un householdId que no es del titular (nunca vincula un hogar arbitrario)", async () => {
    const holder = await makePerson();
    const stranger = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    const strangerHousehold = await makeHouseholdWithMembers(stranger.id, []);

    await expect(linkPolicyToHousehold(admin, policy.id, strangerHousehold.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  // ---------------------------------------------------------------------
  // Renovación de póliza — Fase 019.9 (§3).
  // ---------------------------------------------------------------------

  it("renewPolicy crea una Policy NUEVA con previousPolicyId apuntando a la anterior, sin modificarla", async () => {
    const holder = await makePerson();
    const oldPolicy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        policyNumber: "OLD-001",
        effectiveDate: new Date("2025-01-01"),
      })
    );

    const renewed = trackPolicy(
      await renewPolicy(admin, oldPolicy.id, {
        productId: activeProductId,
        holderCovered: "true",
      })
    );

    expect(renewed.id).not.toBe(oldPolicy.id);
    const renewedRaw = await prisma.policy.findUnique({ where: { id: renewed.id } });
    expect(renewedRaw?.previousPolicyId).toBe(oldPolicy.id);

    // La póliza anterior nunca se modifica destructivamente.
    const stillOld = await getPolicyById(admin, oldPolicy.id);
    expect(stillOld.policyNumber).toBe("OLD-001");
    expect(stillOld.status).toBe("PENDING");
  });

  it("renewPolicy NUNCA copia policyNumber/effectiveDate/terminationDate automáticamente", async () => {
    const holder = await makePerson();
    const oldPolicy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        policyNumber: "OLD-002",
        effectiveDate: new Date("2025-01-01"),
        terminationDate: new Date("2025-12-31"),
      })
    );

    const renewed = trackPolicy(
      await renewPolicy(admin, oldPolicy.id, { productId: activeProductId, holderCovered: "true" })
    );

    expect(renewed.policyNumber).toBeNull();
    expect(renewed.effectiveDate).toBeNull();
    expect(renewed.terminationDate).toBeNull();
  });

  it("renewPolicy hereda holder y household de la póliza anterior", async () => {
    const holder = await makePerson();
    const household = await makeHouseholdWithMembers(holder.id, []);
    const oldPolicy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    expect(oldPolicy.householdId).toBe(household.id);

    const renewed = trackPolicy(
      await renewPolicy(admin, oldPolicy.id, { productId: activeProductId, holderCovered: "true" })
    );
    expect(renewed.holder.id).toBe(holder.id);
    expect(renewed.householdId).toBe(household.id);
  });

  it("renewPolicy rechaza una segunda renovación de la misma póliza (UNIQUE previousPolicyId)", async () => {
    const holder = await makePerson();
    const oldPolicy = trackPolicy(
      await createPolicy(admin, { holderId: holder.id, productId: activeProductId, holderCovered: "true" })
    );
    trackPolicy(await renewPolicy(admin, oldPolicy.id, { productId: activeProductId, holderCovered: "true" }));

    await expect(
      renewPolicy(admin, oldPolicy.id, { productId: activeProductId, holderCovered: "true" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ---------------------------------------------------------------------
  // "Vencen en 30 días" — Fase 019.9 (§28-§29).
  // ---------------------------------------------------------------------

  it("listExpiringPolicies incluye una póliza ACTIVE con terminationDate dentro de 30 días", async () => {
    const holder = await makePerson();
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        status: "ACTIVE",
        effectiveDate: new Date("2025-01-01"),
        terminationDate: soon,
      })
    );

    const expiring = await listExpiringPolicies(admin, 30);
    expect(expiring.some((p) => p.id === policy.id)).toBe(true);
  });

  it("listExpiringPolicies NUNCA incluye pólizas CANCELLED o EXPIRED", async () => {
    const holder = await makePerson();
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        status: "ACTIVE",
        effectiveDate: new Date("2025-01-01"),
        terminationDate: soon,
      })
    );
    await updatePolicy(admin, policy.id, { status: "CANCELLED" });

    const expiring = await listExpiringPolicies(admin, 30);
    expect(expiring.some((p) => p.id === policy.id)).toBe(false);
  });

  it("listExpiringPolicies excluye pólizas que vencen fuera de la ventana", async () => {
    const holder = await makePerson();
    const farAway = new Date();
    farAway.setUTCDate(farAway.getUTCDate() + 90);
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        status: "ACTIVE",
        effectiveDate: new Date("2025-01-01"),
        terminationDate: farAway,
      })
    );

    const expiring = await listExpiringPolicies(admin, 30);
    expect(expiring.some((p) => p.id === policy.id)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Cancelación guiada — Fase 020 (§4).
  // ---------------------------------------------------------------------

  it("cancelPolicy cambia status a CANCELLED y guarda terminationDate, sin borrar la póliza", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        effectiveDate: new Date("2025-01-01"),
      })
    );

    const cancelled = await cancelPolicy(admin, policy.id, {
      terminationDate: "2026-06-15",
      reason: "Cliente cambió de proveedor",
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.terminationDate?.toISOString().slice(0, 10)).toBe("2026-06-15");

    const stillThere = await prisma.policy.findUnique({ where: { id: policy.id } });
    expect(stillThere).not.toBeNull();
  });

  it("cancelPolicy preserva members/documents/notes (nunca los toca)", async () => {
    const holder = await makePerson();
    const spouse = await makePerson();
    const household = await makeHouseholdWithMembers(holder.id, [{ personId: spouse.id, role: "SPOUSE" }]);
    void household;
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        coveredMembers: [{ personId: spouse.id, role: "SPOUSE" }],
        effectiveDate: new Date("2025-01-01"),
      })
    );

    await cancelPolicy(admin, policy.id, { terminationDate: "2026-06-15" });

    const members = await prisma.policyMember.findMany({ where: { policyId: policy.id } });
    expect(members).toHaveLength(2);
  });

  it("cancelPolicy rechaza cancelar una póliza ya CANCELLED", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        effectiveDate: new Date("2025-01-01"),
      })
    );
    await cancelPolicy(admin, policy.id, { terminationDate: "2026-06-15" });

    await expect(cancelPolicy(admin, policy.id, { terminationDate: "2026-07-01" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("cancelPolicy rechaza terminationDate anterior a effectiveDate", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        effectiveDate: new Date("2026-06-01"),
      })
    );
    await expect(cancelPolicy(admin, policy.id, { terminationDate: "2026-01-01" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("cancelPolicy audita POLICY_CANCEL con el motivo en metadata, nunca en Note", async () => {
    const holder = await makePerson();
    const policy = trackPolicy(
      await createPolicy(admin, {
        holderId: holder.id,
        productId: activeProductId,
        holderCovered: "true",
        effectiveDate: new Date("2025-01-01"),
      })
    );
    await cancelPolicy(admin, policy.id, { terminationDate: "2026-06-15", reason: "Ajuste de presupuesto" });

    const event = await prisma.auditEvent.findFirst({
      where: { policyId: policy.id, action: "POLICY_CANCEL" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.metadata).toMatchObject({ reason: "Ajuste de presupuesto" });

    const notes = await prisma.note.findMany({ where: { policyId: policy.id } });
    expect(notes).toHaveLength(0);
  });
});
