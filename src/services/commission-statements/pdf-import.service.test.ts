import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPolicy } from "@/services/policies.service";
import { createCommissionRule, generateExpectationForPeriod } from "@/services/commission-rules.service";
import {
  uploadCommissionStatement,
  getCommissionStatementPreview,
  applyCommissionStatement,
  manualMatchStatementRow,
  ignoreStatementRow,
  listCommissionStatements,
} from "./reconciliation.service";
import { createCommissionExpectation, addCommissionPayment } from "@/services/commissions.service";
import { OrangeOwnPdfAdapter } from "./orange-own-pdf-adapter";
import { OrangeReferralPdfAdapter } from "./orange-referral-pdf-adapter";
import { EliteReferralPdfAdapter } from "./elite-referral-pdf-adapter";
import { buildTestTablePdf, makePdfFile } from "./test-pdf-builder";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Fase 025.5 — importación real de comisiones HEALTH desde PDF (Orange/
// Oscar propia, Orange/Kaiser referida, Elite/BCBS referida). Todos los
// datos aquí son SINTÉTICOS (nombres, Member ID, DOB fabricados) — nunca
// se usa contenido de los PDF reales aportados fuera de este repo (ver
// docs/COMMISSION_RECONCILIATION.md). Los PDF se generan con
// test-pdf-builder.ts (texto posicionado vía Tm/Tj, Helvetica estándar)
// reproduciendo ÚNICAMENTE la estructura de columnas confirmada.
// ---------------------------------------------------------------------------

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
}

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdHouseholdIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdRuleProductIds: string[] = [];
const createdLicenseIds: string[] = [];
const createdContractIds: string[] = [];
const createdStatementIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${uniqueName("")}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function makePerson(firstName: string, lastName: string, state: string) {
  const person = await prisma.person.create({ data: { firstName, lastName, contactStatus: "CLIENT" } });
  createdPersonIds.push(person.id);
  const household = await prisma.household.create({ data: { state } });
  createdHouseholdIds.push(household.id);
  await prisma.householdMember.create({ data: { householdId: household.id, personId: person.id, role: "HEAD" } });
  return { person, household };
}

// Crea una póliza HEALTH ACTIVE con expectativa de comisión ya generada
// para el período de pago dado — `own: true` da de alta licencia +
// contrato del agente para ese carrier+estado (=> businessSource=OWN);
// `own: false` deja el hogar sin ningún agente licenciado/con contrato
// para ese carrier+estado (=> businessSource=REFERRAL, nunca UNKNOWN
// porque el estado del hogar sí es conocido).
async function makeHealthPolicy(
  admin: AuthorizedUser,
  opts: { firstName: string; lastName: string; carrierName: string; state: string; own: boolean; expectedAmount: string; period: Date }
) {
  const { person, household } = await makePerson(opts.firstName, opts.lastName, opts.state);
  const carrier = await prisma.carrier.create({ data: { name: opts.carrierName } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan PDF"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);

  if (opts.own) {
    const agentForOwn = await makeActor("AGENT", "agent-pdf-own");
    const license = await prisma.agentLicense.create({
      data: { userId: agentForOwn.id, state: opts.state, status: "ACTIVE" },
    });
    createdLicenseIds.push(license.id);
    const contract = await prisma.agentCarrierContract.create({
      data: { userId: agentForOwn.id, carrierId: carrier.id, state: opts.state, policyType: "HEALTH", status: "ACTIVE" },
    });
    createdContractIds.push(contract.id);
  }

  const policy = await createPolicy(admin, {
    holderId: person.id,
    productId: product.id,
    holderCovered: "false",
    status: "ACTIVE",
    effectiveDate: new Date("2020-01-01"),
  });
  createdPolicyIds.push(policy.id);
  createdRuleProductIds.push(product.id);
  void household;

  await createCommissionRule(admin, {
    productId: product.id,
    method: "FIXED_AMOUNT",
    base: "FIXED",
    initialAmount: opts.expectedAmount,
    initialPeriodicity: "MONTHLY",
  });
  const periodStr = `${opts.period.getUTCFullYear()}-${String(opts.period.getUTCMonth() + 1).padStart(2, "0")}`;
  const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period: periodStr });
  const expectationId = (generated as { expectationId: string }).expectationId;

  return { person, carrier, policy, expectationId };
}

// Fase 025.5.5 (UAT-16/17) — igual que makeHealthPolicy, pero SIN regla
// ni expectativa de comisión: la Policy queda lista para emparejar,
// pero deliberadamente no existe ninguna CommissionExpectation todavía
// (el escenario real: el pago llega antes de que nosotros registremos
// cuánto esperábamos).
async function makeHealthPolicyNoExpectation(
  admin: AuthorizedUser,
  opts: { firstName: string; lastName: string; carrierName: string; state: string }
) {
  const { person } = await makePerson(opts.firstName, opts.lastName, opts.state);
  const carrier = await prisma.carrier.create({ data: { name: opts.carrierName } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan PDF"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);

  const agentForOwn = await makeActor("AGENT", "agent-pdf-noexp");
  const license = await prisma.agentLicense.create({ data: { userId: agentForOwn.id, state: opts.state, status: "ACTIVE" } });
  createdLicenseIds.push(license.id);
  const contract = await prisma.agentCarrierContract.create({
    data: { userId: agentForOwn.id, carrierId: carrier.id, state: opts.state, policyType: "HEALTH", status: "ACTIVE" },
  });
  createdContractIds.push(contract.id);

  const policy = await createPolicy(admin, {
    holderId: person.id,
    productId: product.id,
    holderCovered: "false",
    status: "ACTIVE",
    effectiveDate: new Date("2020-01-01"),
  });
  createdPolicyIds.push(policy.id);
  createdRuleProductIds.push(product.id);

  return { person, carrier, policy, productId: product.id };
}

let admin: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-pdfimport");
});

afterAll(async () => {
  // Fase 025.5.5: ahora CommissionPayment.policyId es directo (nunca
  // solo vía commissionExpectationId) — filtrar por los policyId
  // trackeados cubre tanto pagos aplicados desde un statement como
  // pagos manuales (ver test W), nunca deja huérfanos que bloqueen el
  // borrado de Policy más abajo (FK Restrict).
  await prisma.commissionPayment.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionStatementRow.deleteMany({ where: { statementId: { in: createdStatementIds } } });
  await prisma.commissionStatement.deleteMany({ where: { id: { in: createdStatementIds } } });
  await prisma.policyExternalReference.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionExpectation.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionRule.deleteMany({ where: { productId: { in: createdRuleProductIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.agentCarrierContract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.agentLicense.deleteMany({ where: { id: { in: createdLicenseIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

const PAID_AT = "2026-08-15";
const PAID_PERIOD = new Date(Date.UTC(2026, 7, 1));

describe("Adaptadores PDF reales (Fase 025.5.3) — agencia+modalidad, nunca carrier", () => {
  describe("OrangeOwnPdfAdapter (ORANGE_OWN — carrier-agnóstico)", () => {
    const headers = [
      "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
      "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
    ];

    it("A) parsea filas reales del layout, fija payerAgency=ORANGE/businessModality=OWN/policyType=HEALTH", async () => {
      const memberId = uniqueName("OSC");
      const pdf = buildTestTablePdf([
        headers,
        [memberId, "Firstname Lastname", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeOwnPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.payerAgency).toBe("ORANGE");
      expect(result.businessModality).toBe("OWN");
      expect(result.policyType).toBe("HEALTH");
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.externalMemberId).toBe(memberId);
      expect(row.receivedAmount).toBe("50.00");
      expect(row.assistanceAmount).toBe("6.00");
      expect(row.netAmount).toBe("44.00");
    });

    // Fase 025.5.3: "Member ID" es una variante ESTRUCTURAL del layout
    // (algunos reportes reales la traen, otros no) — nunca una columna
    // obligatoria ni una opción de negocio. El mismo adapter acepta
    // ambos casos sin que el ADMIN elija nada al respecto.
    it("B) Member ID es opcional — un archivo sin esa columna se parsea igual, sin exigirla", async () => {
      const withoutMemberId = headers.filter((h) => h !== "Member ID");
      const pdf = buildTestTablePdf([
        withoutMemberId,
        ["Firstname Lastname", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeOwnPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].externalMemberId).toBeNull();
    });

    it("C) valida Subtotal - Asistencia = Total por fila; una discrepancia genera warning, nunca bloquea", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Otra Persona", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "40.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeOwnPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.rows[0].warnings?.some((w) => w.includes("no coincide"))).toBe(true);
    });

    it("D) footer 'Total' declarado se reporta como declaredTotal (nunca como fuente de verdad)", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Persona Uno", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
        ["Total", "", "", "", "", "", "", "", "", "", "44.00", "", ""],
      ]);
      const result = await OrangeOwnPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.rows).toHaveLength(1); // la fila de pie nunca se cuenta como fila de datos
      expect(result.declaredTotal).toBe("44.00");
    });

    // CORRECCIÓN ADICIONAL: "Orange propia acepta archivos
    // estructuralmente válidos de diferentes carriers" — el mismo
    // adapter, sin ninguna opción distinta, procesa Oscar Y Ambetter
    // (u otro carrier) igual, porque el carrier nunca fue parte de la
    // selección — solo del contenido.
    it("acepta archivos de carriers DISTINTOS (Oscar, Ambetter) con la misma estructura, sin cambiar de adapter", async () => {
      const oscarPdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Persona Oscar", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
      ]);
      const ambetterPdf = buildTestTablePdf([
        headers,
        [uniqueName("AMB"), "Persona Ambetter", "Agent A", "FL", "Ambetter", "ACTIVE", "30.00", "1", "30.00", "0.00", "30.00", "2026-08-01", PAID_AT],
      ]);
      const oscarResult = await OrangeOwnPdfAdapter.parse(oscarPdf, "oscar.pdf");
      const ambetterResult = await OrangeOwnPdfAdapter.parse(ambetterPdf, "ambetter.pdf");
      expect(oscarResult.detectedCarrierRaw).toBe("Oscar");
      expect(ambetterResult.detectedCarrierRaw).toBe("Ambetter");
      // Ambos conservan la MISMA modalidad — el carrier nunca la altera.
      expect(oscarResult.businessModality).toBe("OWN");
      expect(ambetterResult.businessModality).toBe("OWN");
    });

    it("un reporte con MÁS DE UN carrier distinto en el mismo archivo se rechaza por completo", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Persona Uno", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
        [uniqueName("AMB"), "Persona Dos", "Agent A", "FL", "Ambetter", "ACTIVE", "30.00", "1", "30.00", "0.00", "30.00", "2026-08-01", PAID_AT],
      ]);
      await expect(OrangeOwnPdfAdapter.parse(pdf, "mixed.pdf")).rejects.toThrow(/más de un carrier/);
    });
  });

  describe("OrangeReferralPdfAdapter (ORANGE_REFERRAL — carrier-agnóstico, sin Member ID)", () => {
    const headers = [
      "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
      "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
    ];

    it("E) parsea correctamente SIN columna Member ID; fija businessModality=REFERRAL", async () => {
      const pdf = buildTestTablePdf([
        headers,
        ["Nombre Kaiser", "Agent B", "GA", "Kaiser", "ACTIVE", "30.00", "1", "60.00", "0.00", "60.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeReferralPdfAdapter.parse(pdf, "kaiser.pdf");
      expect(result.payerAgency).toBe("ORANGE");
      expect(result.businessModality).toBe("REFERRAL");
      expect(result.rows[0].externalMemberId).toBeNull();
      expect(result.rows[0].receivedAmount).toBe("60.00");
      expect(result.detectedCarrierRaw).toBe("Kaiser");
    });

    it("acepta archivos de carriers distintos (Kaiser, BCBS) bajo la misma modalidad referida", async () => {
      const kaiserPdf = buildTestTablePdf([
        headers,
        ["Persona Kaiser", "Agent B", "GA", "Kaiser", "ACTIVE", "30.00", "1", "60.00", "0.00", "60.00", "2026-08-01", PAID_AT],
      ]);
      const bcbsPdf = buildTestTablePdf([
        headers,
        ["Persona BCBS", "Agent B", "SC", "BCBS", "ACTIVE", "40.00", "1", "40.00", "0.00", "40.00", "2026-08-01", PAID_AT],
      ]);
      const kaiserResult = await OrangeReferralPdfAdapter.parse(kaiserPdf, "kaiser.pdf");
      const bcbsResult = await OrangeReferralPdfAdapter.parse(bcbsPdf, "bcbs.pdf");
      expect(kaiserResult.detectedCarrierRaw).toBe("Kaiser");
      expect(bcbsResult.detectedCarrierRaw).toBe("BCBS");
      expect(kaiserResult.businessModality).toBe("REFERRAL");
      expect(bcbsResult.businessModality).toBe("REFERRAL");
    });
  });

  describe("EliteReferralPdfAdapter (ELITE_REFERRAL — carrier-agnóstico, con CLIENT DOB, sin Status)", () => {
    const headers = [
      "REPORT", "CARRIER", "MEMBER ID", "Agent", "CLIENT/TITLE", "CLIENT DOB", "STATE",
      "RATE", "EFFECTIVE DATE", "APPLICANTS", "SUBTOTAL", "ASISTENCIA", "TOTAL", "MONTH PAID",
    ];

    it("F) parsea el layout distinto de Elite (con DOB, sin Status); fija businessModality=REFERRAL siempre", async () => {
      const pdf = buildTestTablePdf([
        headers,
        ["RPT1", "BlueCross", uniqueName("ELM"), "Agent C", "Persona Elite", "1990-05-20", "SC", "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT],
      ]);
      const result = await EliteReferralPdfAdapter.parse(pdf, "elite.pdf");
      expect(result.payerAgency).toBe("ELITE");
      expect(result.businessModality).toBe("REFERRAL");
      const row = result.rows[0];
      expect(row.status).toBeNull(); // este formato no reporta Status
      expect(row.dateOfBirth?.toISOString().slice(0, 10)).toBe("1990-05-20");
      expect(row.receivedAmount).toBe("80.00");
      expect(row.netAmount).toBe("75.00");
      expect(result.detectedCarrierRaw).toBe("BlueCross");
    });

    it("acepta carriers distintos (BlueCross, Cigna) con la misma estructura Elite", async () => {
      const bcPdf = buildTestTablePdf([
        headers,
        ["RPT1", "BlueCross", uniqueName("ELM"), "Agent C", "Persona Uno", "1990-05-20", "SC", "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT],
      ]);
      const cignaPdf = buildTestTablePdf([
        headers,
        ["RPT1", "Cigna", uniqueName("ELM"), "Agent C", "Persona Dos", "1985-03-10", "NC", "35.00", "2026-08-01", "1", "70.00", "5.00", "65.00", PAID_AT],
      ]);
      const bcResult = await EliteReferralPdfAdapter.parse(bcPdf, "bc.pdf");
      const cignaResult = await EliteReferralPdfAdapter.parse(cignaPdf, "cigna.pdf");
      expect(bcResult.detectedCarrierRaw).toBe("BlueCross");
      expect(cignaResult.detectedCarrierRaw).toBe("Cigna");
      expect(bcResult.businessModality).toBe("REFERRAL");
      expect(cignaResult.businessModality).toBe("REFERRAL");
    });

    it("un reporte Elite con más de un carrier distinto se rechaza por completo", async () => {
      const pdf = buildTestTablePdf([
        headers,
        ["RPT1", "BlueCross", uniqueName("ELM"), "Agent C", "Persona Uno", "1990-05-20", "SC", "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT],
        ["RPT1", "Cigna", uniqueName("ELM"), "Agent C", "Persona Dos", "1985-03-10", "NC", "35.00", "2026-08-01", "1", "70.00", "5.00", "65.00", PAID_AT],
      ]);
      await expect(EliteReferralPdfAdapter.parse(pdf, "mixed.pdf")).rejects.toThrow(/más de un carrier/);
    });

    it("G) CLIENT DOB nunca se persiste en CommissionStatementRow — solo vive en memoria durante el matching", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [
          "RPT1", "BlueCross", uniqueName("ELM"), "Agent C", uniqueName("Persona Elite Dos"), "1985-03-10", "SC",
          "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT,
        ],
      ]);
      const upload = await uploadCommissionStatement(admin, "ELITE_REFERRAL", makePdfFile(pdf, uniqueName("elite") + ".pdf"));
      if (upload.duplicate) throw new Error("unexpected duplicate");
      createdStatementIds.push(upload.statementId);
      const row = await prisma.commissionStatementRow.findFirst({ where: { statementId: upload.statementId } });
      expect(row?.metadata ? JSON.stringify(row.metadata).includes("1985-03-10") : false).toBe(false);
    });
  });
});

describe("Fase 025.5 — reconciliation.service wiring con reportes PDF reales", () => {
  const oscarHeaders = [
    "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
    "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
  ];

  it("H) el statement persiste payerAgency/businessModality/assistanceTotal/netTotal/footerMatchesNet", async () => {
    const { person, carrier } = await makeHealthPolicy(admin, {
      firstName: "Wiring", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarCarrier"),
      state: "TX", own: true, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const memberId = uniqueName("OSC");
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [memberId, `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
      ["Total", "", "", "", "", "", "", "", "", "", "44.00", "", ""],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.statement.payerAgency).toBe("ORANGE");
    expect(preview.statement.businessModality).toBe("OWN");
    expect(preview.statement.assistanceTotal.toFixed(2)).toBe("6.00");
    expect(preview.statement.netTotal.toFixed(2)).toBe("44.00");
    expect(preview.statement.footerMatchesNet).toBe(true);
    expect(preview.rows[0].matchStatus).toBe("MATCHED");
  });

  it("I) modalidad incompatible (reporte OWN vs póliza histórica REFERRAL) nunca auto-aplica ni reclasifica businessSource", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Referida", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarCarrierRef"),
      state: "GA", own: false, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const before = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id }, select: { businessSource: true } });
    expect(before.businessSource).toBe("REFERRAL");

    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "GA", carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].matchStatus).toBe("INVALID");
    expect(preview.rows[0].errorCode).toMatch(/propias/);

    await applyCommissionStatement(admin, upload.statementId);
    const paymentCount = await prisma.commissionPayment.count({ where: { commissionExpectation: { policyId: policy.id } } });
    expect(paymentCount).toBe(0); // nunca se aplica una fila INVALID

    const after = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id }, select: { businessSource: true } });
    expect(after.businessSource).toBe("REFERRAL"); // nunca reclasificado por el importador
  });

  it("J) un pago HEALTH nunca se vincula a una póliza de otro producto (policyType=HEALTH exigido en el matching)", async () => {
    const { person, household } = await makePerson("Dental", uniqueName("Persona"), "FL");
    const carrier = await prisma.carrier.create({ data: { name: uniqueName("DentalCarrier") } });
    createdCarrierIds.push(carrier.id);
    const product = await prisma.product.create({
      data: { carrierId: carrier.id, name: uniqueName("Plan Dental"), policyType: "DENTAL" },
    });
    createdProductIds.push(product.id);
    const policy = await createPolicy(admin, {
      holderId: person.id, productId: product.id, holderCovered: "false", status: "ACTIVE",
      effectiveDate: new Date("2020-01-01"),
    });
    createdPolicyIds.push(policy.id);
    void household;

    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "FL", carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].matchStatus).toBe("UNMATCHED"); // la póliza DENTAL nunca es candidata
  });

  it("K) fila duplicada (mismo miembro+período+monto) en un reporte reenviado con otro nombre de archivo nunca se re-aplica", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Duplicado", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarCarrierDup"),
      state: "TX", own: true, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const memberId = uniqueName("OSC");
    const row = [memberId, `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT];

    const pdf1 = buildTestTablePdf([oscarHeaders, row]);
    const upload1 = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf1, uniqueName("oscar1") + ".pdf"));
    if (upload1.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload1.statementId);
    const preview1 = await getCommissionStatementPreview(admin, upload1.statementId);
    expect(preview1.rows[0].matchStatus).toBe("MATCHED");
    await applyCommissionStatement(admin, upload1.statementId);

    // Reporte corregido/reenviado: repite la fila ya aplicada (mismo
    // miembro+período+monto -> mismo rowFingerprint) PERO agrega una
    // fila nueva, así que el fingerprint del ARCHIVO completo es
    // distinto (nunca se bloquea a nivel de archivo) y solo la fila
    // repetida debe salir como DUPLICATE.
    const extraRow = [
      uniqueName("OSC2"), `${person.firstName} Segunda`, "Agent A", "TX", carrier.name,
      "ACTIVE", "10.00", "1", "20.00", "0.00", "20.00", "2026-08-01", PAID_AT,
    ];
    const pdf2 = buildTestTablePdf([oscarHeaders, row, extraRow]);
    const upload2 = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf2, uniqueName("oscar2") + ".pdf"));
    if (upload2.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload2.statementId);
    const preview2 = await getCommissionStatementPreview(admin, upload2.statementId);
    expect(preview2.rows[0].matchStatus).toBe("DUPLICATE");

    await applyCommissionStatement(admin, upload2.statementId);
    const paymentCount = await prisma.commissionPayment.count({ where: { commissionExpectation: { policyId: policy.id } } });
    expect(paymentCount).toBe(1); // nunca se duplica el pago
  });

  it("L) al aplicar, CommissionPayment.amount = Subtotal (receivedAmount) — Asistencia y Neto nunca generan su propio pago", async () => {
    const { policy } = await makeHealthPolicy(admin, {
      firstName: "Neto", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarCarrierNeto"),
      state: "TX", own: true, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const policyFresh = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id }, select: { holder: { select: { firstName: true, lastName: true } } } });
    const carrierRow = await prisma.product.findFirstOrThrow({ where: { policies: { some: { id: policy.id } } }, select: { carrier: { select: { name: true } } } });

    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${policyFresh.holder.firstName} ${policyFresh.holder.lastName}`, "Agent A", "TX", carrierRow.carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    const payment = await prisma.commissionPayment.findFirstOrThrow({
      where: { commissionExpectation: { policyId: policy.id } },
      select: { amount: true },
    });
    expect(payment.amount.toFixed(2)).toBe("50.00"); // Subtotal, nunca Total (44.00) ni Asistencia (6.00)
  });

  it("M) el preview enmascara el Member ID (solo confirma los últimos 4 caracteres, nunca el valor completo)", async () => {
    const { person, carrier } = await makeHealthPolicy(admin, {
      firstName: "Masked", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarCarrierMask"),
      state: "TX", own: true, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const memberId = `${uniqueName("OSC")}9876`;
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [memberId, `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    const maskedId = preview.rows[0].externalId;
    expect(maskedId).not.toBe(memberId);
    expect(maskedId).toMatch(/^\*+9876$/);

    // El valor real sigue existiendo en la fila persistida (necesario
    // para el matching y para PolicyExternalReference) — solo el DTO de
    // preview lo enmascara.
    const rawRow = await prisma.commissionStatementRow.findFirstOrThrow({ where: { statementId: upload.statementId } });
    expect(rawRow.externalId).toBe(memberId);
  });

  // -------------------------------------------------------------------
  // CORRECCIÓN ADICIONAL — el selector de fuente ya NO incluye el
  // carrier (ORANGE_OWN/ORANGE_REFERRAL/ELITE_REFERRAL solamente); el
  // carrier real se detecta del PDF, se busca en el catálogo de
  // carriers existente (nunca se crea uno nuevo) y se muestra separado
  // de agencia/modalidad en el preview.
  // -------------------------------------------------------------------

  it("N) el preview muestra agencia, modalidad y carrier como datos SEPARADOS, y el carrier detectado (existente en el catálogo) queda reconocido", async () => {
    const { person, carrier } = await makeHealthPolicy(admin, {
      firstName: "CarrierOk", lastName: uniqueName("Persona"), carrierName: uniqueName("RealCarrier"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    // Tres datos separados, nunca mezclados en un solo campo.
    expect(preview.statement.payerAgency).toBe("ORANGE");
    expect(preview.statement.businessModality).toBe("OWN");
    expect(preview.statement.detectedCarrierName).toBe(carrier.name);
    expect(preview.statement.carrierRecognized).toBe(true);
  });

  it("O) un carrier detectado que NO existe en el catálogo se marca como no reconocido y bloquea el apply (nunca se crea el Carrier automáticamente)", async () => {
    const { person } = await makeHealthPolicy(admin, {
      firstName: "CarrierBad", lastName: uniqueName("Persona"), carrierName: uniqueName("SomeOtherCarrier"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const unknownCarrierName = uniqueName("CarrierNuncaRegistrado");
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", unknownCarrierName, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.statement.detectedCarrierName).toBe(unknownCarrierName);
    expect(preview.statement.carrierRecognized).toBe(false); // el preview SIGUE disponible para revisión

    await expect(applyCommissionStatement(admin, upload.statementId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("no existe en el catálogo"),
    });

    const carrierCount = await prisma.carrier.count({ where: { name: unknownCarrierName } });
    expect(carrierCount).toBe(0); // nunca se crea un Carrier automáticamente
  });

  it("P) el carrier detectado NUNCA determina ni cambia la modalidad/agencia del statement (vienen exclusivamente del selector)", async () => {
    // Mismo carrier (BCBS) usado bajo DOS modalidades distintas — el
    // resultado debe respetar exactamente lo que el ADMIN seleccionó al
    // subir, nunca inferir la modalidad a partir del nombre del carrier.
    const carrierName = uniqueName("BCBS");
    const carrier = await prisma.carrier.create({ data: { name: carrierName } });
    createdCarrierIds.push(carrier.id);

    const ownPdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), "Persona Propia", "Agent A", "IL", carrierName, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
    ]);
    const uploadOwn = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(ownPdf, uniqueName("own") + ".pdf"));
    if (uploadOwn.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(uploadOwn.statementId);
    const previewOwn = await getCommissionStatementPreview(admin, uploadOwn.statementId);
    expect(previewOwn.statement.businessModality).toBe("OWN");
    expect(previewOwn.statement.detectedCarrierName).toBe(carrierName);

    const referralPdf = buildTestTablePdf([
      [
        "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
        "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
      ],
      ["Persona Referida", "Agent A", "SC", carrierName, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT],
    ]);
    const uploadReferral = await uploadCommissionStatement(admin, "ORANGE_REFERRAL", makePdfFile(referralPdf, uniqueName("ref") + ".pdf"));
    if (uploadReferral.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(uploadReferral.statementId);
    const previewReferral = await getCommissionStatementPreview(admin, uploadReferral.statementId);
    expect(previewReferral.statement.businessModality).toBe("REFERRAL");
    expect(previewReferral.statement.detectedCarrierName).toBe(carrierName);
  });
});

// ---------------------------------------------------------------------------
// Fase 025.5.5 (UAT-16/17) — un pago real puede llegar ANTES de que
// exista la CommissionExpectation correspondiente; cuando esta se crea
// después, los pagos pendientes se vinculan retroactivamente sin
// reimportar el archivo, sin duplicar pagos y sin tocar montos/fechas
// ya registrados.
// ---------------------------------------------------------------------------
describe("Fase 025.5.5 (UAT-16/17) — pagos sin expectativa y recalculo posterior", () => {
  const oscarHeaders = [
    "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
    "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
  ];

  it("Q) una fila MATCHED sin CommissionExpectation SÍ se aplica: Esperado=$0, estado Sin expectativa, diferencia provisional = recibido", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "PreExp", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarNoExp"), state: "TX",
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "81.00", "9.00", "72.00", "2026-07-01", "2026-07-15"],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const beforeApply = await getCommissionStatementPreview(admin, upload.statementId);
    expect(beforeApply.rows[0].matchStatus).toBe("MATCHED");
    expect(beforeApply.rows[0].reviewState).toBe("NO_EXPECTATION");
    expect(beforeApply.rows[0].expectedAmount).toBe("0.00");
    expect(beforeApply.rows[0].difference).toBe("81.00");

    const afterApply = await applyCommissionStatement(admin, upload.statementId);
    expect(afterApply.rows[0].matchStatus).toBe("APPLIED");
    expect(afterApply.rows[0].alreadyApplied).toBe(true);

    const payment = await prisma.commissionPayment.findFirstOrThrow({ where: { policyId: policy.id } });
    expect(payment.commissionExpectationId).toBeNull();
    expect(payment.amount.toFixed(2)).toBe("81.00");
    expect(payment.period.toISOString()).toBe(new Date(Date.UTC(2026, 6, 1)).toISOString());
  });

  it("R) crear la expectativa DESPUÉS vincula el pago existente automáticamente — sin reimportar, sin duplicar, sin tocar el pago histórico", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Recalc", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarRecalc"), state: "TX",
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "81.00", "9.00", "72.00", "2026-07-01", "2026-07-15"],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    const paymentBefore = await prisma.commissionPayment.findFirstOrThrow({ where: { policyId: policy.id } });
    const originalCreatedAt = paymentBefore.createdAt.getTime();
    const originalAmount = paymentBefore.amount.toFixed(2);

    // Crear la expectativa DESPUÉS, para el mismo período ($81 exacto —
    // "esperado mayor o menor" se cubre en los tests S/T de abajo).
    await createCommissionExpectation(admin, {
      policyId: policy.id,
      period: "2026-07",
      expectedAmount: "81.00",
    });

    const paymentAfter = await prisma.commissionPayment.findUniqueOrThrow({ where: { id: paymentBefore.id } });
    expect(paymentAfter.commissionExpectationId).not.toBeNull();
    // Nunca se toca el pago histórico: mismo monto, misma fecha de creación.
    expect(paymentAfter.amount.toFixed(2)).toBe(originalAmount);
    expect(paymentAfter.createdAt.getTime()).toBe(originalCreatedAt);
    // Nunca se creó un segundo pago.
    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(1);

    // La vista de conciliación queda consistente sin reimportar el PDF.
    const previewAfter = await getCommissionStatementPreview(admin, upload.statementId);
    expect(previewAfter.rows[0].reviewState).toBe("MATCH");
    expect(previewAfter.rows[0].expectedAmount).toBe("81.00");
    expect(previewAfter.rows[0].difference).toBe("0.00");
  });

  it("S) expectativa MENOR a lo recibido tras el recalculo produce OVERPAID", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Over", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarOver"), state: "TX",
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "100.00", "0.00", "100.00", "2026-07-01", "2026-07-15"],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    await createCommissionExpectation(admin, { policyId: policy.id, period: "2026-07", expectedAmount: "60.00" });

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].reviewState).toBe("OVERPAID");
    expect(preview.rows[0].difference).toBe("40.00");
  });

  it("T) expectativa MAYOR a lo recibido tras el recalculo produce UNDERPAID", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Under", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarUnder"), state: "TX",
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "50.00", "0.00", "50.00", "2026-07-01", "2026-07-15"],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    await createCommissionExpectation(admin, { policyId: policy.id, period: "2026-07", expectedAmount: "80.00" });

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].reviewState).toBe("UNDERPAID");
    expect(preview.rows[0].difference).toBe("-30.00");
  });

  it("U) varios pagos sin expectativa para la misma Policy+período se vinculan TODOS al crear la expectativa (pago parcial acumulado)", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Partial", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarPartial"), state: "TX",
    });
    const row1 = [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "30.00", "0.00", "30.00", "2026-07-01", "2026-07-10"];
    const pdf1 = buildTestTablePdf([oscarHeaders, row1]);
    const upload1 = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf1, uniqueName("oscar1") + ".pdf"));
    if (upload1.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload1.statementId);
    await applyCommissionStatement(admin, upload1.statementId);

    const row2 = [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "50.00", "0.00", "50.00", "2026-07-01", "2026-07-20"];
    const pdf2 = buildTestTablePdf([oscarHeaders, row2]);
    const upload2 = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf2, uniqueName("oscar2") + ".pdf"));
    if (upload2.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload2.statementId);
    await applyCommissionStatement(admin, upload2.statementId);

    await createCommissionExpectation(admin, { policyId: policy.id, period: "2026-07", expectedAmount: "80.00" });

    const linkedPayments = await prisma.commissionPayment.findMany({ where: { policyId: policy.id }, select: { commissionExpectationId: true, amount: true } });
    expect(linkedPayments).toHaveLength(2);
    expect(linkedPayments.every((p) => p.commissionExpectationId !== null)).toBe(true);
    const total = linkedPayments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    expect(total.toFixed(2)).toBe("80.00");
  });

  it("V) recalculo es idempotente — crear la expectativa dos veces (segunda falla por período duplicado) nunca duplica ni desvincula pagos", async () => {
    const { person, carrier, policy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Idem", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarIdem"), state: "TX",
    });
    const pdf = buildTestTablePdf([
      oscarHeaders,
      [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "40.00", "0.00", "40.00", "2026-07-01", "2026-07-15"],
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    await createCommissionExpectation(admin, { policyId: policy.id, period: "2026-07", expectedAmount: "40.00" });
    await expect(
      createCommissionExpectation(admin, { policyId: policy.id, period: "2026-07", expectedAmount: "40.00" })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(1); // nunca se duplicó
  });

  it("W) un pago manual (addCommissionPayment, Fase 016) sigue guardando policyId/period correctamente y nunca rompe el flujo existente", async () => {
    const { policy } = await makeHealthPolicy(admin, {
      firstName: "Manual", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarManual"),
      state: "TX", own: true, expectedAmount: "44.00", period: PAID_PERIOD,
    });
    const expectation = await prisma.commissionExpectation.findFirstOrThrow({ where: { policyId: policy.id } });
    const result = await addCommissionPayment(admin, expectation.id, {
      type: "PAYMENT",
      amount: "44.00",
      receivedAt: "08/15/2026",
    });
    void result;
    const payment = await prisma.commissionPayment.findFirstOrThrow({ where: { commissionExpectationId: expectation.id } });
    expect(payment.policyId).toBe(policy.id);
    expect(payment.period.getUTCFullYear()).toBe(2026);
    expect(payment.period.getUTCMonth()).toBe(7); // agosto (0-indexed)
  });
});

// ---------------------------------------------------------------------------
// Fase 025.5.5 (UAT-18) — reanudar el mismo archivo. La regla ya existía
// desde Fase 020/025.5 (uploadCommissionStatement detecta el
// fingerprint y devuelve el statement EXISTENTE sin tocar nada), pero
// nunca había una prueba end-to-end que demostrara que TODO el trabajo
// administrativo previo (match manual, fila ignorada, fila aplicada,
// auditoría) sobrevive intacto a una re-subida del mismo archivo.
// ---------------------------------------------------------------------------
describe("Fase 025.5.5 (UAT-18) — reanudar el mismo archivo sin bloquear ni duplicar", () => {
  const headers = [
    "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
    "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
  ];

  it("X) subir el mismo archivo dos veces reabre el statement existente conservando matches manuales, filas ignoradas y filas aplicadas — nunca duplica nada", async () => {
    const { person: matchedPerson, carrier, policy: matchedPolicy } = await makeHealthPolicy(admin, {
      firstName: "Resume", lastName: uniqueName("Matched"), carrierName: uniqueName("OscarResume"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const { policy: manualPolicy } = await makeHealthPolicyNoExpectation(admin, {
      firstName: "Resume", lastName: uniqueName("Manual"), carrierName: uniqueName("OscarResumeManual"), state: "TX",
    });

    const autoRow = [uniqueName("OSC"), `${matchedPerson.firstName} ${matchedPerson.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT];
    const manualRow = [uniqueName("OSC"), uniqueName("Sin Coincidencia"), "Agent A", "TX", carrier.name, "ACTIVE", "10.00", "1", "10.00", "0.00", "10.00", "2026-08-01", PAID_AT];
    const ignoredRow = [uniqueName("OSC"), uniqueName("Se Ignora"), "Agent A", "TX", carrier.name, "ACTIVE", "5.00", "1", "5.00", "0.00", "5.00", "2026-08-01", PAID_AT];
    const pdf = buildTestTablePdf([headers, autoRow, manualRow, ignoredRow]);
    const fileName = uniqueName("resume") + ".pdf";

    const first = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, fileName));
    if (first.duplicate) throw new Error("unexpected duplicate on first upload");
    createdStatementIds.push(first.statementId);

    // Trabajo administrativo previo: aplicar la fila auto-emparejada,
    // emparejar manualmente la segunda, ignorar la tercera.
    await applyCommissionStatement(admin, first.statementId);
    const previewBeforeManual = await getCommissionStatementPreview(admin, first.statementId);
    const manualRowId = previewBeforeManual.rows[1].id;
    const ignoredRowId = previewBeforeManual.rows[2].id;
    await manualMatchStatementRow(admin, manualRowId, { policyId: manualPolicy.id });
    await ignoreStatementRow(admin, ignoredRowId);

    const beforeResume = await getCommissionStatementPreview(admin, first.statementId);
    expect(beforeResume.rows[0].matchStatus).toBe("APPLIED");
    expect(beforeResume.rows[1].matchStatus).toBe("MATCHED");
    expect(beforeResume.rows[2].matchStatus).toBe("IGNORED");
    const paymentCountBefore = await prisma.commissionPayment.count({ where: { policyId: matchedPolicy.id } });
    expect(paymentCountBefore).toBe(1);

    // Re-subir EXACTAMENTE el mismo contenido (nombre de archivo
    // distinto, como haría un ADMIN que vuelve a descargar el reporte).
    const second = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("resume-again") + ".pdf"));
    expect(second.duplicate).toBe(true);
    if (!second.duplicate) throw new Error("expected duplicate on second upload");
    expect(second.existingStatementId).toBe(first.statementId); // nunca crea un statement nuevo

    const afterResume = await getCommissionStatementPreview(admin, first.statementId);
    // Todo el trabajo previo sigue exactamente igual — nada se resetea.
    expect(afterResume.rows[0].matchStatus).toBe("APPLIED");
    expect(afterResume.rows[1].matchStatus).toBe("MATCHED");
    expect(afterResume.rows[1].matchedPolicy?.id).toBe(manualPolicy.id);
    expect(afterResume.rows[2].matchStatus).toBe("IGNORED");

    // Nunca se duplicó el statement, sus filas, ni el pago aplicado.
    const statementCount = await prisma.commissionStatement.count({ where: { fingerprint: (await prisma.commissionStatement.findUniqueOrThrow({ where: { id: first.statementId }, select: { fingerprint: true } })).fingerprint } });
    expect(statementCount).toBe(1);
    expect(afterResume.rows).toHaveLength(3);
    const paymentCountAfter = await prisma.commissionPayment.count({ where: { policyId: matchedPolicy.id } });
    expect(paymentCountAfter).toBe(1);
  });

  it("Y) un archivo MODIFICADO (fingerprint distinto) crea un statement nuevo, y sus filas ya aplicadas antes se marcan DUPLICATE (nunca UNMATCHED, nunca se reaplican)", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Modified", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarModified"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const sharedRow = [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT];

    const pdf1 = buildTestTablePdf([headers, sharedRow]);
    const first = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf1, uniqueName("v1") + ".pdf"));
    if (first.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(first.statementId);
    await applyCommissionStatement(admin, first.statementId);

    // Archivo "corregido/reenviado": la fila anterior se repite tal
    // cual, PERO se agrega una fila nueva — el fingerprint del ARCHIVO
    // cambia, así que esta vez NO se detecta como duplicado a nivel de
    // archivo (se crea un statement nuevo), pero la fila repetida sí se
    // reconoce por su rowFingerprint individual.
    const newRow = [uniqueName("OSC2"), uniqueName("Persona Nueva"), "Agent A", "TX", carrier.name, "ACTIVE", "15.00", "1", "15.00", "0.00", "15.00", "2026-08-01", PAID_AT];
    const pdf2 = buildTestTablePdf([headers, sharedRow, newRow]);
    const second = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf2, uniqueName("v2") + ".pdf"));
    if (second.duplicate) throw new Error("expected a NEW statement (different file fingerprint)");
    createdStatementIds.push(second.statementId);
    expect(second.statementId).not.toBe(first.statementId);

    const preview = await getCommissionStatementPreview(admin, second.statementId);
    expect(preview.rows[0].matchStatus).toBe("DUPLICATE"); // la fila ya aplicada antes, nunca UNMATCHED
    expect(preview.rows[1].matchStatus).toBe("UNMATCHED"); // la fila realmente nueva sigue pendiente de revisión

    await applyCommissionStatement(admin, second.statementId);
    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(1); // la fila DUPLICATE nunca generó un segundo pago
  });
});

describe("Fase 025.5.5 (UAT-19) — período de comisión, nunca la fecha de subida", () => {
  const headers = [
    "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
    "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
  ];

  it("Z) la MISMA póliza pagada en enero/febrero/marzo produce TRES pagos legítimos — nunca se tratan como duplicados", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Meses", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarMeses"),
      state: "TX", own: true, expectedAmount: "25.00", period: new Date(Date.UTC(2026, 0, 1)),
    });
    // Misma persona/carrier/monto, tres meses distintos de "Paid At" —
    // el rowFingerprint debe distinguirlos por período, nunca colapsar
    // en un solo pago.
    const months = [
      { paidAt: "2026-01-15", effective: "2026-01-01" },
      { paidAt: "2026-02-15", effective: "2026-01-01" },
      { paidAt: "2026-03-15", effective: "2026-01-01" },
    ];
    for (const m of months) {
      const row = [
        uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name,
        "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", m.effective, m.paidAt,
      ];
      const pdf = buildTestTablePdf([headers, row]);
      const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("m") + ".pdf"));
      if (upload.duplicate) throw new Error("unexpected duplicate — meses distintos nunca son el mismo archivo");
      createdStatementIds.push(upload.statementId);
      const preview = await getCommissionStatementPreview(admin, upload.statementId);
      expect(preview.rows[0].matchStatus).not.toBe("DUPLICATE");
      expect(preview.rows[0].commissionPeriod?.toISOString().slice(0, 7)).toBe(m.paidAt.slice(0, 7));
      await applyCommissionStatement(admin, upload.statementId);
    }

    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(3); // tres pagos reales distintos, ninguno eliminado/colapsado
  });

  it("AA) el historial resume el rango real de meses de un reporte (nunca la fecha de subida) — un solo mes vs varios meses", async () => {
    const { person: p1, carrier: c1 } = await makeHealthPolicy(admin, {
      firstName: "Historial1", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarHist1"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const singleMonthRow = [uniqueName("OSC"), `${p1.firstName} ${p1.lastName}`, "Agent A", "TX", c1.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT];
    const pdfSingle = buildTestTablePdf([headers, singleMonthRow]);
    const singleUpload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdfSingle, uniqueName("single") + ".pdf"));
    if (singleUpload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(singleUpload.statementId);

    const { person: p2, carrier: c2 } = await makeHealthPolicy(admin, {
      firstName: "Historial2", lastName: uniqueName("Persona"), carrierName: uniqueName("OscarHist2"),
      state: "TX", own: true, expectedAmount: "25.00", period: new Date(Date.UTC(2026, 0, 1)),
    });
    const multiMonthRows = [
      [uniqueName("OSC"), `${p2.firstName} ${p2.lastName}`, "Agent A", "TX", c2.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-01-01", "2026-01-15"],
      [uniqueName("OSC2"), `${p2.firstName} ${p2.lastName}`, "Agent A", "TX", c2.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-07-01", "2026-07-15"],
    ];
    const pdfMulti = buildTestTablePdf([headers, ...multiMonthRows]);
    const multiUpload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdfMulti, uniqueName("multi") + ".pdf"));
    if (multiUpload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(multiUpload.statementId);

    const list = await listCommissionStatements(admin);
    const singleEntry = list.find((s) => s.id === singleUpload.statementId);
    const multiEntry = list.find((s) => s.id === multiUpload.statementId);
    expect(singleEntry?.periodSummary).toMatchObject({ distinctMonths: 1 });
    expect(singleEntry?.periodSummary?.min.toISOString().slice(0, 7)).toBe("2026-08");
    expect(multiEntry?.periodSummary?.distinctMonths).toBe(2);
    expect(multiEntry?.periodSummary?.min.toISOString().slice(0, 7)).toBe("2026-01");
    expect(multiEntry?.periodSummary?.max.toISOString().slice(0, 7)).toBe("2026-07");
  });
});

describe("Fase 025.5.5 — TOTAL GENERAL EN REPORTES MULTIPÁGINA: nunca se aplica un total no verificable", () => {
  const headers = [
    "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
    "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
  ];

  it("BB) un total declarado que NO reconcilia con la suma de las filas mostradas se marca footerAmbiguous=true, footerMatchesNet=false y bloquea el apply", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Footer", lastName: uniqueName("Ambiguo"), carrierName: uniqueName("OscarFooter"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const row = [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT];
    // Footer declarado ($999.00) no coincide con el neto real de la
    // única fila del reporte ($25.00) — nunca se asume que igual es
    // el total general correcto.
    const pdf = buildTestTablePdf([headers, row, ["Total", "", "", "", "", "", "", "", "", "", "999.00", "", ""]]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("footer") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.statement.declaredFooterTotal?.toFixed(2)).toBe("999.00");
    expect(preview.statement.footerMatchesNet).toBe(false);
    expect(preview.statement.footerAmbiguous).toBe(true);
    expect(preview.rows[0].matchStatus).toBe("MATCHED"); // el preview sigue disponible para revisión

    await expect(applyCommissionStatement(admin, upload.statementId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("no verificable"),
    });
    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(0); // nunca se aplica mientras el total no sea verificable
  });

  it("CC) un total declarado que SÍ reconcilia con la suma de las filas mostradas nunca se marca ambiguo, y el apply procede normalmente", async () => {
    const { person, carrier, policy } = await makeHealthPolicy(admin, {
      firstName: "Footer", lastName: uniqueName("Ok"), carrierName: uniqueName("OscarFooterOk"),
      state: "TX", own: true, expectedAmount: "25.00", period: PAID_PERIOD,
    });
    const row = [uniqueName("OSC"), `${person.firstName} ${person.lastName}`, "Agent A", "TX", carrier.name, "ACTIVE", "25.00", "1", "25.00", "0.00", "25.00", "2026-08-01", PAID_AT];
    const pdf = buildTestTablePdf([headers, row, ["Total", "", "", "", "", "", "", "", "", "", "25.00", "", ""]]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(pdf, uniqueName("footerok") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.statement.footerMatchesNet).toBe(true);
    expect(preview.statement.footerAmbiguous).toBe(false);

    await applyCommissionStatement(admin, upload.statementId);
    const paymentCount = await prisma.commissionPayment.count({ where: { policyId: policy.id } });
    expect(paymentCount).toBe(1);
  });
});
