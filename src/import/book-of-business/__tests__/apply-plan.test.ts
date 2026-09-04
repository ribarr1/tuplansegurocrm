import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { parseCsv, csvRowsToRecords } from "../csv";
import { parseSourceRecords } from "../parse-source";
import { buildImportPlan } from "../build-plan";
import { applyImportPlan } from "../apply-plan";
import { buildFixtureCsv, type FixtureRow } from "./fixture";

// Integración contra la DB real de desarrollo (mismo criterio que el
// resto de los tests de servicio) — NUNCA llama resetBusinessDataForImport()
// aquí (destruiría datos de OTROS archivos de test); solo ejercita
// applyImportPlan con un carrier ficticio exclusivo de este archivo y
// limpia todo lo que crea explícitamente al final.

const FIXTURE_CARRIER = `Fixture Carrier ${Date.now()}`;

async function applyFixture(rows: FixtureRow[]) {
  const csv = buildFixtureCsv(rows);
  const records = csvRowsToRecords(parseCsv(csv));
  const { rows: sourceRows, issues } = parseSourceRecords(records);
  const plan = await buildImportPlan(sourceRows, issues, [{ name: FIXTURE_CARRIER }]);
  expect(plan.readyToImport).toBe(true);
  return applyImportPlan(plan, [FIXTURE_CARRIER]);
}

afterAll(async () => {
  const carrier = await prisma.carrier.findUnique({ where: { name: FIXTURE_CARRIER }, select: { id: true } });
  if (!carrier) return;
  const products = await prisma.product.findMany({ where: { carrierId: carrier.id }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  const policies = await prisma.policy.findMany({ where: { productId: { in: productIds } }, select: { id: true, holderId: true } });
  const policyIds = policies.map((p) => p.id);

  await prisma.policyExternalReference.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.healthPolicyDetail.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.note.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.auditEvent.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policy.updateMany({ where: { id: { in: policyIds } }, data: { previousPolicyId: null } });
  await prisma.policy.deleteMany({ where: { id: { in: policyIds } } });

  const holderIds = [...new Set(policies.map((p) => p.holderId))];
  const householdMembers = await prisma.householdMember.findMany({ where: { personId: { in: holderIds } }, select: { householdId: true, personId: true } });
  const householdIds = [...new Set(householdMembers.map((m) => m.householdId))];
  const allMemberPersonIds = (
    await prisma.householdMember.findMany({ where: { householdId: { in: householdIds } }, select: { personId: true } })
  ).map((m) => m.personId);
  const personIds = [...new Set(allMemberPersonIds)];

  await prisma.auditEvent.deleteMany({ where: { contactPersonId: { in: personIds } } });
  await prisma.personSensitiveIdentity.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.product.deleteMany({ where: { carrierId: carrier.id } });
  await prisma.carrier.delete({ where: { id: carrier.id } });
});

const HOLDER_ROW: FixtureRow = {
  INDEX: "50001",
  ESTATUS: "PROCESADA",
  "TITULAR NOMBRE Y APELLIDO": "Applyfixture Holder",
  "FECHA DE INICIO": "01/01/2026",
  ESTADO: "ILLINOIS",
  "COMPAÑIA DE SEGUROS": FIXTURE_CARRIER,
  PLAN: "Apply Test Plan",
  PRIMA: "300",
  "TITULAR NOMBRE": "Applyfixture",
  "TITULAR APELLIDO": "Holder",
  "TITULAR FECHA DE NACIMIENTO": "05/10/1985",
  "TITULAR NUMERO DE SEGURIDAD SOCIAL": "123-45-6789",
  "TITULAR USCIS#": "A123456789",
  "TITULAR TIPO DE DOCUMENTO": "GREEN CARD",
  "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
  "TIPO DE APLICACION": "CLIENTE NUEVO",
  OBSERVACIONES: "Nota de prueba del importador",
};

describe("book-of-business apply-plan (integración)", () => {
  it("crea Person + Household + Policy + PolicyMember (holder cubierto -> PRIMARY)", async () => {
    const result = await applyFixture([HOLDER_ROW]);
    expect(result.personsCreated).toBe(1);
    expect(result.householdsCreated).toBe(1);
    expect(result.policiesCreated).toBe(1);
    expect(result.policyMembersCreated).toBe(1);
    expect(result.carriersCreated).toBe(1);
    expect(result.productsCreated).toBe(1);
    expect(result.notesImported).toBe(1);

    const person = await prisma.person.findFirst({
      where: { firstName: "Applyfixture", lastName: "Holder" },
      select: { id: true, contactStatus: true },
    });
    expect(person).not.toBeNull();
    // recomputePersonContactStatus debe pasarlo a CLIENT: tiene cobertura ACTIVE.
    expect(person!.contactStatus).toBe("CLIENT");

    const member = await prisma.policyMember.findFirst({ where: { personId: person!.id }, select: { role: true } });
    expect(member?.role).toBe("PRIMARY");
  });

  it("el SSN y el USCIS se guardan cifrados, nunca en texto plano en la DB", async () => {
    const person = await prisma.person.findFirst({
      where: { firstName: "Applyfixture", lastName: "Holder" },
      select: { id: true },
    });
    const identity = await prisma.personSensitiveIdentity.findUnique({ where: { personId: person!.id } });
    expect(identity).not.toBeNull();
    expect(identity!.ssnEncrypted).not.toContain("123456789");
    expect(identity!.ssnEncrypted).not.toBeNull();
    expect(identity!.ssnLast4).toBe("6789");
    expect(identity!.uscisNumberEncrypted).not.toContain("A123456789");
    expect(identity!.uscisNumberLast4).toBe("6789");
    expect(identity!.immigrationCategory).toBe("LAWFUL_PERMANENT_RESIDENT");
  });

  it("no crea PolicyMember para un miembro sin bandera de cobertura", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      INDEX: "50002",
      "TITULAR NOMBRE Y APELLIDO": "Applyfixture Uncovered",
      "TITULAR NOMBRE": "Applyfixture",
      "TITULAR APELLIDO": "Uncovered",
      "TITULAR FECHA DE NACIMIENTO": "01/01/1970",
      "TITULAR NUMERO DE SEGURIDAD SOCIAL": "",
      "TITULAR USCIS#": "",
      "TITULAR TIPO DE DOCUMENTO": "",
      "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?": "NO",
      OBSERVACIONES: "",
    };
    const result = await applyFixture([row]);
    expect(result.policyMembersCreated).toBe(0);

    const person = await prisma.person.findFirst({
      where: { firstName: "Applyfixture", lastName: "Uncovered" },
      select: { id: true, contactStatus: true },
    });
    expect(person).not.toBeNull();
    // Sin PolicyMember activo -> nunca pasa a CLIENT.
    expect(person!.contactStatus).toBe("PROSPECT");
  });

  it("Hallazgo #1 (Fase 024): el sexo se persiste en Person.sex", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      INDEX: "50003",
      "TITULAR NOMBRE Y APELLIDO": "Applyfixture Sexo",
      "TITULAR NOMBRE": "Applyfixture",
      "TITULAR APELLIDO": "Sexo",
      "TITULAR FECHA DE NACIMIENTO": "02/02/1980",
      "TITULAR SEXO": "Mujer",
      "TITULAR NUMERO DE SEGURIDAD SOCIAL": "",
      "TITULAR USCIS#": "",
      "TITULAR TIPO DE DOCUMENTO": "",
      OBSERVACIONES: "",
    };
    await applyFixture([row]);
    const person = await prisma.person.findFirst({
      where: { firstName: "Applyfixture", lastName: "Sexo" },
      select: { sex: true },
    });
    expect(person?.sex).toBe("FEMALE");
  });

  it("Fase 024, Parte C (corregido en Fase 025, Parte A): una póliza HEALTH 2025 normalizada a EXPIRED nunca convierte al titular en CLIENT", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      INDEX: "50004",
      "TITULAR NOMBRE Y APELLIDO": "Applyfixture Historico2025",
      "TITULAR NOMBRE": "Applyfixture",
      "TITULAR APELLIDO": "Historico2025",
      "TITULAR FECHA DE NACIMIENTO": "03/03/1975",
      "FECHA DE INICIO": "01/01/2025",
      ESTATUS: "PROCESADA",
      "TITULAR NUMERO DE SEGURIDAD SOCIAL": "",
      "TITULAR USCIS#": "",
      "TITULAR TIPO DE DOCUMENTO": "",
      OBSERVACIONES: "",
    };
    await applyFixture([row]);

    const person = await prisma.person.findFirst({
      where: { firstName: "Applyfixture", lastName: "Historico2025" },
      select: { contactStatus: true },
    });
    expect(person?.contactStatus).toBe("PROSPECT");

    const policy = await prisma.policy.findFirst({
      where: { holder: { firstName: "Applyfixture", lastName: "Historico2025" } },
      select: { status: true, terminationDate: true },
    });
    expect(policy?.status).toBe("EXPIRED");
    expect(policy?.terminationDate?.toISOString().slice(0, 10)).toBe("2025-12-31");
  });
});
