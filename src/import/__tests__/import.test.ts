import { describe, it, expect, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildImportPlan } from "@/import/plan";
import { applyImportPlan } from "@/import/apply";
import { writeJsonReport } from "@/import/report";
import { matchAgainstPool } from "@/import/matching";
import { normalizeEmail, normalizePhone, normalizeName } from "@/import/normalize";
import { dateCell } from "@/import/workbook";
import { getSheet } from "@/import/workbook";
import { buildFixtureWorkbook, writeTempWorkbook, cleanupTempWorkbook, type ClienteRow } from "./fixture";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const tempFiles: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierNames: string[] = [];

async function planFromRows(
  clientesRows: ClienteRow[],
  extra?: {
    comisionesRows?: Record<string, string | number>[];
    estimacionRows?: Record<string, string | number>[];
    includeCredentialsSheet?: boolean;
  }
) {
  const workbook = buildFixtureWorkbook({ clientesRows, ...extra });
  const filePath = await writeTempWorkbook(workbook);
  tempFiles.push(filePath);
  return buildImportPlan(filePath, { commissionYear: 2026 });
}

afterEach(async () => {
  while (tempFiles.length) await cleanupTempWorkbook(tempFiles.pop()!);
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({
    where: { commissionExpectation: { policy: { holder: { id: { in: createdPersonIds } } } } },
  });
  await prisma.commissionExpectation.deleteMany({ where: { policy: { holderId: { in: createdPersonIds } } } });
  await prisma.healthPolicyDetail.deleteMany({ where: { policy: { holderId: { in: createdPersonIds } } } });
  await prisma.policyMember.deleteMany({ where: { policy: { holderId: { in: createdPersonIds } } } });
  await prisma.policy.deleteMany({ where: { holderId: { in: createdPersonIds } } });
  await prisma.householdMember.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { carrier: { name: { in: createdCarrierNames } } } });
  await prisma.carrier.deleteMany({ where: { name: { in: createdCarrierNames } } });
});

function uniqueSuffix() {
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

describe("import pipeline", () => {
  it("A) workbook válido se lee sin errores", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `Ana Fixture${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Test Plan",
        "TITULAR FECHA DE NACIMIENTO": "05/10/1990",
        "TIPO DE APLICACION": "CLIENTE NUEVO",
      },
    ]);
    expect(plan.sourceFileName).toBe("fixture.xlsx");
    expect(plan.policies.length).toBe(1);
  });

  it("B) hoja faltante se reporta como WARNING, no crashea", async () => {
    const workbook = buildFixtureWorkbook({ clientesRows: [] });
    workbook.removeWorksheet("Comisiones");
    const filePath = await writeTempWorkbook(workbook);
    tempFiles.push(filePath);
    const plan = await buildImportPlan(filePath);
    const issue = plan.issues.find((i) => i.code === "SHEET_NOT_FOUND" && i.sheet === "Comisiones");
    expect(issue?.severity).toBe("WARNING");
  });

  it("C) string vacío se normaliza a null", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("D) fechas de texto se preservan como DATE (día exacto)", async () => {
    const workbook = buildFixtureWorkbook({
      clientesRows: [{ "TITULAR FECHA DE NACIMIENTO": "08/15/1985", "TITULAR NOMBRE Y APELLIDO": "X Y" }],
    });
    const filePath = await writeTempWorkbook(workbook);
    tempFiles.push(filePath);
    const wb2 = await (await import("@/import/workbook")).loadWorkbook(filePath);
    const sheet = getSheet(wb2, "clientes")!;
    const row = sheet.worksheet.getRow(2);
    const date = dateCell(sheet, row, "TITULAR FECHA DE NACIMIENTO");
    expect(date?.getUTCFullYear()).toBe(1985);
    expect(date?.getUTCMonth()).toBe(7);
    expect(date?.getUTCDate()).toBe(15);
  });

  it("E) normalización de email (trim + lowercase)", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("F) normalización de teléfono sin corromper dígitos", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone(null)).toBeNull();
  });

  it("G) match STRONG por email", () => {
    const pool = [{ key: "existing1", data: { firstName: "Ana", lastName: "Ruiz", email: "ana@test.com", phone: null, dateOfBirth: null } }];
    const result = matchAgainstPool(
      { firstName: "Ana", lastName: "Ruiz", email: "ana@test.com", phone: null, dateOfBirth: null },
      pool
    );
    expect(result).toEqual({ outcome: "MATCHED", confidence: "STRONG", matchedKey: "existing1" });
  });

  it("H) match ambiguo (WEAK) se bloquea, no se fusiona", () => {
    const pool = [{ key: "existing1", data: { firstName: "Ana", lastName: "Ruiz", email: null, phone: null, dateOfBirth: null } }];
    const result = matchAgainstPool(
      { firstName: "Ana", lastName: "Ruiz", email: null, phone: null, dateOfBirth: null },
      pool
    );
    expect(result.outcome).toBe("AMBIGUOUS");
  });

  it("I) el mismo titular en 2 filas (2 pólizas) no duplica Person", async () => {
    const suffix = uniqueSuffix();
    const name = `Carlos Duplicado${suffix}`;
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "03/03/1980",
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "03/03/1980",
        "FECHA DE INICIO": "02/15/2026",
        "COMPAÑIA DE SEGUROS": "OSCAR",
        PLAN: "Plan B",
      },
    ]);
    const newPersons = plan.persons.filter((p) => p.outcome === "NEW");
    expect(newPersons.length).toBe(1);
    expect(plan.policies.length).toBe(2);
  });

  it("J) Household se crea con HEAD + SPOUSE + DEPENDENT", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `Titular H${suffix}`,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
        "CONYUGUE NOMBRE": "Spouse",
        "CONYUGUE APELLIDO": `Test${suffix}`,
        "CONYUGUE FECHA DE NACIMIENTO": "02/02/1982",
        "DEPENDIENTE 1 NOMBRE Y APELLIDO": `Kid Test${suffix}`,
        "DEPENDIENTE 1 FECHA DE NACIMIENTO": "05/05/2010",
        "DEPENDIENTE 1 RELACION": "HIJA",
      },
    ]);
    expect(plan.households.length).toBe(1);
    const roles = plan.households[0].memberKeys.map((m) => m.role).sort();
    expect(roles).toEqual(["CHILD", "HEAD", "SPOUSE"]);
  });

  it("K) dependiente normaliza rol CHILD/DEPENDENT según relación", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `Titular K${suffix}`,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
        "DEPENDIENTE 1 NOMBRE Y APELLIDO": `Sobrino Test${suffix}`,
        "DEPENDIENTE 1 FECHA DE NACIMIENTO": "05/05/2010",
        "DEPENDIENTE 1 RELACION": "SOBRINO",
      },
    ]);
    const dep = plan.households[0].memberKeys.find((m) => m.role !== "HEAD");
    expect(dep?.role).toBe("DEPENDENT");
  });

  it("L) mapping explícito de Carrier conocido", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `L Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "ambetter",
        PLAN: "Plan A",
      },
    ]);
    expect(plan.policies[0].carrierName).toBe("Ambetter");
  });

  it("M) Carrier desconocido bloquea y reporta", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `M Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "ASEGURADORA INVENTADA",
        PLAN: "Plan A",
      },
    ]);
    expect(plan.policies.length).toBe(0);
    expect(plan.issues.some((i) => i.code === "UNKNOWN_CARRIER" && i.severity === "BLOCKING")).toBe(true);
    expect(plan.readyToImport).toBe(false);
  });

  it("Q) ACTIVE sin FECHA DE INICIO bloquea la fila", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `Q Test${uniqueSuffix()}`,
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
    ]);
    expect(plan.policies[0].blocked).toBe(true);
    expect(plan.policies[0].blockReason).toBe("ACTIVE_MISSING_EFFECTIVE_DATE");
    expect(plan.readyToImport).toBe(false);
  });

  it("R) múltiples pólizas del mismo titular se conservan ambas", async () => {
    const suffix = uniqueSuffix();
    const name = `R Test${suffix}`;
    const plan = await planFromRows([
      {
        ESTATUS: "BRADON",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
      {
        ESTATUS: "BRADON",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "COMPAÑIA DE SEGUROS": "OSCAR",
        PLAN: "Plan B",
      },
    ]);
    expect(plan.policies.length).toBe(2);
  });

  it("V) no se importan credenciales de 'cuentas aseguradoras'", async () => {
    const plan = await planFromRows([], { includeCredentialsSheet: true });
    const issue = plan.issues.find((i) => i.code === "SHEET_EXCLUDED_CREDENTIALS");
    expect(issue?.severity).toBe("EXCLUDED_SENSITIVE");
    expect(JSON.stringify(plan)).not.toContain("fixture-user");
    expect(JSON.stringify(plan)).not.toContain("fixture-pass");
  });

  it("W/X) no se leen SSN ni datos bancarios — solo se cuentan", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `WX Test${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
        "TITULAR NUMERO DE SEGURIDAD SOCIAL": "123-45-6789",
        BANCO: "Fixture Bank",
        "NUMERO DE CUENTA": "9999999999",
      },
    ]);
    expect(plan.sensitiveSummary.rowsWithExcludedData).toBe(1);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("123-45-6789");
    expect(serialized).not.toContain("Fixture Bank");
    expect(serialized).not.toContain("9999999999");
  });

  it("Y) fichamedica queda diferida — solo se cuenta, nunca se importa detalle", async () => {
    const workbook = buildFixtureWorkbook({ clientesRows: [] });
    workbook.getWorksheet("fichamedica")!.addRow(["Fixture Person", "Ibuprofeno"]);
    const filePath = await writeTempWorkbook(workbook);
    tempFiles.push(filePath);
    const plan = await buildImportPlan(filePath);
    expect(plan.deferredMedical.peopleWithApparentMedicalData).toBe(1);
    expect(JSON.stringify(plan)).not.toContain("Ibuprofeno");
  });

  it("Z) ASISTENCIA=SI mapea a needsPaymentAssistance", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `Z Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
        ASISTENCIA: "SI",
      },
    ]);
    expect(plan.policies[0].needsPaymentAssistance).toBe(true);
  });

  it("AA/AB/AC) columnas de mes -> CommissionExpectation con period=día 1 y Decimal preservado", async () => {
    const suffix = uniqueSuffix();
    const name = `AA Test${suffix}`;
    const plan = await planFromRows(
      [
        {
          ESTATUS: "PROCESADA",
          "TITULAR NOMBRE Y APELLIDO": name,
          "FECHA DE INICIO": "01/15/2026",
          "COMPAÑIA DE SEGUROS": "AMBETTER",
          PLAN: "Plan A",
        },
      ],
      { estimacionRows: [{ "TITULAR NOMBRE Y APELLIDO": name, "COMPAÑIA DE SEGUROS": "AMBETTER", ENE: "125.50", FEB: 130 }] }
    );
    expect(plan.commissionExpectations.length).toBe(2);
    const jan = plan.commissionExpectations.find((e) => e.period.getUTCMonth() === 0)!;
    expect(jan.period.getUTCDate()).toBe(1);
    expect(jan.expectedAmount).toBe("125.50");
  });

  it("AD) pagos de comisión se vinculan fielmente a su póliza", async () => {
    const suffix = uniqueSuffix();
    const name = `AD Test${suffix}`;
    const plan = await planFromRows(
      [
        {
          ESTATUS: "PROCESADA",
          "TITULAR NOMBRE Y APELLIDO": name,
          "FECHA DE INICIO": "01/15/2026",
          "COMPAÑIA DE SEGUROS": "AMBETTER",
          PLAN: "Plan A",
        },
      ],
      { comisionesRows: [{ "TITULAR NOMBRE Y APELLIDO": name, "COMPAÑIA DE SEGUROS": "AMBETTER", ENE: "40.00" }] }
    );
    expect(plan.commissionPayments.length).toBe(1);
    expect(plan.commissionPayments[0].matchedPolicy).toBe(plan.policies[0]);
  });

  it("AE) agente sin mapping se reporta INFO, no bloquea", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AE Test${uniqueSuffix()}`,
        AGENTE: "AGENTE DESCONOCIDO",
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
    ]);
    expect(plan.issues.some((i) => i.code === "UNMAPPED_AGENT" && i.severity === "INFO")).toBe(true);
    expect(plan.readyToImport).toBe(true);
  });

  it("AF) dry run no escribe nada en PostgreSQL", async () => {
    const before = await prisma.person.count();
    await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AF Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
    ]);
    const after = await prisma.person.count();
    expect(after).toBe(before);
  });

  it("AG/AH) el reporte JSON se genera y no contiene valores prohibidos", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AGH Test${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
        "TITULAR NUMERO DE SEGURIDAD SOCIAL": "987-65-4321",
      },
    ]);
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "import-report-"));
    const outPath = path.join(outDir, "import-report.json");
    await writeJsonReport(plan, outPath);
    const content = await fs.readFile(outPath, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
    expect(content).not.toContain("987-65-4321");
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("AJ) fixture limpio produce READY_TO_IMPORT=true", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AJ Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan A",
      },
    ]);
    expect(plan.readyToImport).toBe(true);
  });

  it("AK) apply escribe el grafo esperado (Person/Household/Policy/HealthPolicyDetail)", async () => {
    const suffix = uniqueSuffix();
    const name = `AK Test${suffix}`;
    createdCarrierNames.push("Ambetter", "Oscar", "Blue Cross Blue Shield (BCBS)", "Kaiser Permanente");
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "TITULAR EMAIL": `ak.${suffix}@test.local`,
        "FECHA DE INICIO": "01/15/2026",
        ESTADO: "FLORIDA",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AK",
        DEDUCIBLE: "1500",
        "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
      },
    ]);
    expect(plan.readyToImport).toBe(true);
    const result = await applyImportPlan(plan);
    expect(result.personsCreated).toBe(1);
    expect(result.policiesCreated).toBe(1);
    expect(result.healthDetailsCreated).toBe(1);

    const person = await prisma.person.findFirst({ where: { email: `ak.${suffix}@test.local` } });
    expect(person).not.toBeNull();
    createdPersonIds.push(person!.id);

    const policy = await prisma.policy.findFirst({ where: { holderId: person!.id }, include: { members: true } });
    expect(policy?.members.some((m) => m.role === "PRIMARY")).toBe(true);

    const detail = await prisma.healthPolicyDetail.findUnique({ where: { policyId: policy!.id } });
    expect(detail?.marketplaceState).toBe("FL");
  });

  it("AM) aplicar dos veces no duplica (reutiliza Person/Policy vía re-match)", async () => {
    const suffix = uniqueSuffix();
    const name = `AM Test${suffix}`;
    createdCarrierNames.push("Ambetter");
    const rows: ClienteRow[] = [
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": name,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1981",
        "TITULAR EMAIL": `am.${suffix}@test.local`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AM",
      },
    ];

    const plan1 = await planFromRows(rows);
    const result1 = await applyImportPlan(plan1);
    expect(result1.personsCreated).toBe(1);
    expect(result1.policiesCreated).toBe(1);

    const person = await prisma.person.findFirst({ where: { email: `am.${suffix}@test.local` } });
    createdPersonIds.push(person!.id);

    // Segunda corrida: el matching vuelve a consultar la DB, ahora ya
    // existe el Person con ese email -> MATCHED, y la Policy con el
    // mismo (holderId, productId, effectiveDate) ya existe -> reutilizada.
    const plan2 = await planFromRows(rows);
    const result2 = await applyImportPlan(plan2);
    expect(result2.personsCreated).toBe(0);
    expect(result2.personsReused).toBe(1);
    expect(result2.policiesCreated).toBe(0);
    expect(result2.policiesSkippedExisting).toBe(1);

    const personCountAfter = await prisma.person.count({ where: { email: `am.${suffix}@test.local` } });
    expect(personCountAfter).toBe(1);
  });

  it("AN) reutiliza Carrier existente en vez de duplicarlo", async () => {
    const suffix = uniqueSuffix();
    const carrierName = `Fixture Carrier ${suffix}`;
    // Este carrier no está en CARRIER_NAME_MAP, así que la fila quedaría
    // bloqueada por UNKNOWN_CARRIER — se verifica en su lugar contra un
    // carrier ya mapeado (Ambetter), confirmando que apply.ts encuentra
    // el existente antes de crear uno nuevo.
    const preexisting = await prisma.carrier.create({ data: { name: "Ambetter" } }).catch(() => null);
    const existingCarrier = preexisting ?? (await prisma.carrier.findUnique({ where: { name: "Ambetter" } }))!;
    createdCarrierNames.push("Ambetter");

    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AN Test${suffix}`,
        "TITULAR EMAIL": `an.${suffix}@test.local`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AN",
      },
    ]);
    const result = await applyImportPlan(plan);
    expect(result.policiesCreated).toBe(1);

    const person = await prisma.person.findFirst({ where: { email: `an.${suffix}@test.local` } });
    createdPersonIds.push(person!.id);
    const policy = await prisma.policy.findFirst({ where: { holderId: person!.id }, include: { product: true } });
    expect(policy?.product.carrierId).toBe(existingCarrier.id);

    const carrierCount = await prisma.carrier.count({ where: { name: "Ambetter" } });
    expect(carrierCount).toBe(1);
    void carrierName;
  });

  it("AO) el import no borra ni toca registros existentes no relacionados", async () => {
    const untouched = await prisma.person.create({
      data: { firstName: "Untouched", lastName: `Person${uniqueSuffix()}`, contactStatus: "CLIENT" },
    });
    createdPersonIds.push(untouched.id);

    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AO Test${suffix}`,
        "TITULAR EMAIL": `ao.${suffix}@test.local`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AO",
      },
    ]);
    createdCarrierNames.push("Ambetter");
    await applyImportPlan(plan);
    const created = await prisma.person.findFirst({ where: { email: `ao.${suffix}@test.local` } });
    createdPersonIds.push(created!.id);

    const stillThere = await prisma.person.findUnique({ where: { id: untouched.id } });
    expect(stillThere?.firstName).toBe("Untouched");
  });

  it("AP) dirección/condado del titular se propagan al Household cuando hay hogar", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AP Test${suffix}`,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AP",
        "TITULAR DIRECCION": "123 Fixture St, Testville, FL, 12345",
        "TITULAR CONDADO": "FIXTURE COUNTY",
        "CONYUGUE NOMBRE": "Spouse",
        "CONYUGUE APELLIDO": `AP${suffix}`,
        "CONYUGUE FECHA DE NACIMIENTO": "02/02/1982",
      },
    ]);
    expect(plan.households.length).toBe(1);
    expect(plan.households[0].addressLine1).toBe("123 Fixture St, Testville, FL, 12345");
    expect(plan.households[0].county).toBe("FIXTURE COUNTY");
  });

  it("AQ) titular sin hogar con dirección se reporta INFO (no se pierde silenciosamente)", async () => {
    const suffix = uniqueSuffix();
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AQ Test${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AQ",
        "TITULAR DIRECCION": "456 Fixture Ave",
      },
    ]);
    expect(plan.households.length).toBe(0);
    expect(plan.issues.some((i) => i.code === "ADDRESS_WITHOUT_HOUSEHOLD" && i.severity === "INFO")).toBe(true);
  });

  it("AR) FECHA DE TERMINACION anterior a FECHA DE INICIO bloquea la fila", async () => {
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AR Test${uniqueSuffix()}`,
        "FECHA DE INICIO": "06/01/2026",
        "FECHA DE TERMINACION": "01/01/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AR",
      },
    ]);
    expect(plan.policies[0].blocked).toBe(true);
    expect(plan.policies[0].blockReason).toBe("POLICY_TERMINATION_BEFORE_EFFECTIVE");
    expect(
      plan.issues.some((i) => i.code === "POLICY_TERMINATION_BEFORE_EFFECTIVE" && i.severity === "BLOCKING")
    ).toBe(true);
    expect(plan.readyToImport).toBe(false);
  });

  it("AS) ESTADO presente clasifica MARKETPLACE; ausente reporta UNKNOWN_HEALTH_SOURCE sin bloquear", async () => {
    const suffix = uniqueSuffix();
    const withState = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AS1 Test${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        ESTADO: "FLORIDA",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AS1",
      },
    ]);
    expect(withState.policies[0].healthCoverageSource).toBe("MARKETPLACE");

    const withoutState = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AS2 Test${suffix}`,
        "FECHA DE INICIO": "01/15/2026",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AS2",
      },
    ]);
    expect(withoutState.policies[0].healthCoverageSource).toBeNull();
    expect(withoutState.issues.some((i) => i.code === "UNKNOWN_HEALTH_SOURCE" && i.severity === "WARNING")).toBe(
      true
    );
    expect(withoutState.readyToImport).toBe(true);
  });

  it("AT) apply.ts escribe address/county en Household y healthCoverageSource en Policy", async () => {
    const suffix = uniqueSuffix();
    createdCarrierNames.push("Ambetter");
    const plan = await planFromRows([
      {
        ESTATUS: "PROCESADA",
        "TITULAR NOMBRE Y APELLIDO": `AT Test${suffix}`,
        "TITULAR FECHA DE NACIMIENTO": "01/01/1980",
        "TITULAR EMAIL": `at.${suffix}@test.local`,
        "FECHA DE INICIO": "01/15/2026",
        ESTADO: "FLORIDA",
        "COMPAÑIA DE SEGUROS": "AMBETTER",
        PLAN: "Plan AT",
        "TITULAR DIRECCION": "789 Fixture Blvd",
        "TITULAR CONDADO": "AT COUNTY",
        "CONYUGUE NOMBRE": "Spouse",
        "CONYUGUE APELLIDO": `AT${suffix}`,
        "CONYUGUE FECHA DE NACIMIENTO": "02/02/1982",
      },
    ]);
    const result = await applyImportPlan(plan);
    expect(result.householdsCreated).toBe(1);

    const person = await prisma.person.findFirst({ where: { email: `at.${suffix}@test.local` } });
    createdPersonIds.push(person!.id);

    const membership = await prisma.householdMember.findFirst({ where: { personId: person!.id, role: "HEAD" } });
    const household = await prisma.household.findUnique({ where: { id: membership!.householdId } });
    expect(household?.addressLine1).toBe("789 Fixture Blvd");
    expect(household?.county).toBe("AT COUNTY");

    const policy = await prisma.policy.findFirst({ where: { holderId: person!.id } });
    expect(policy?.healthCoverageSource).toBe("MARKETPLACE");
  });
});
