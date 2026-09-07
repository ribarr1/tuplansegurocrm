import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPolicy } from "@/services/policies.service";
import { createCommissionRule, generateExpectationForPeriod } from "@/services/commission-rules.service";
import { uploadCommissionStatement, getCommissionStatementPreview, applyCommissionStatement } from "./reconciliation.service";
import { OrangeOscarPdfAdapter } from "./orange-oscar-pdf-adapter";
import { OrangeKaiserPdfAdapter } from "./orange-kaiser-pdf-adapter";
import { EliteBcbsPdfAdapter } from "./elite-bcbs-pdf-adapter";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Fase 025.5 — importación real de comisiones HEALTH desde PDF (Orange/
// Oscar propia, Orange/Kaiser referida, Elite/BCBS referida). Todos los
// datos aquí son SINTÉTICOS (nombres, Member ID, DOB fabricados) — nunca
// se usa contenido de los PDF reales aportados fuera de este repo (ver
// docs/COMMISSION_RECONCILIATION.md).
//
// Los PDF de prueba se generan a mano (texto posicionado vía Tm/Tj,
// fuente estándar Helvetica, sin dependencias externas) reproduciendo
// ÚNICAMENTE la estructura de columnas confirmada — nunca el contenido
// real.
// ---------------------------------------------------------------------------

// Construye un PDF mínimo válido con una tabla de texto posicionado —
// cada celda es un Tj independiente con Tm absoluto, igual que los PDF
// reales analizados (nunca se concatena texto por caracter).
function buildTestTablePdf(table: string[][]): Buffer {
  const colWidth = 90;
  const startX = 40;
  const startY = 750;
  const lineHeight = 16;

  function escape(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  let content = "BT\n/F1 9 Tf\n";
  table.forEach((row, rowIndex) => {
    const y = startY - rowIndex * lineHeight;
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const x = startX + colIndex * colWidth;
      content += `1 0 0 1 ${x} ${y} Tm\n(${escape(cell)}) Tj\n`;
    });
  });
  content += "ET";

  const maxCols = Math.max(...table.map((r) => r.length));
  const pageWidth = startX * 2 + maxCols * colWidth;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 ${pageWidth} 792] /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

function makePdfFile(buffer: Buffer, name: string): File {
  return new File([new Uint8Array(buffer)], name, { type: "application/pdf" });
}

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

let admin: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-pdfimport");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({ where: { statementRowId: { not: null } } });
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

describe("Adaptadores PDF reales (Fase 025.5) — Orange/Oscar, Orange/Kaiser, Elite/BCBS", () => {
  describe("OrangeOscarPdfAdapter (ORANGE_OWN)", () => {
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
      const result = await OrangeOscarPdfAdapter.parse(pdf, "oscar.pdf");
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

    it("B) exige Member ID como columna requerida — sin ella, rechaza con mensaje claro", async () => {
      const withoutMemberId = headers.filter((h) => h !== "Member ID");
      const pdf = buildTestTablePdf([
        withoutMemberId,
        ["Firstname Lastname", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
      ]);
      await expect(OrangeOscarPdfAdapter.parse(pdf, "oscar.pdf")).rejects.toThrow(/columnas requeridas/);
    });

    it("C) valida Subtotal - Asistencia = Total por fila; una discrepancia genera warning, nunca bloquea", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Otra Persona", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "40.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeOscarPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.rows[0].warnings?.some((w) => w.includes("no coincide"))).toBe(true);
    });

    it("D) footer 'Total' declarado se reporta como declaredTotal (nunca como fuente de verdad)", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [uniqueName("OSC"), "Persona Uno", "Agent A", "IL", "Oscar", "ACTIVE", "25.00", "2", "50.00", "6.00", "44.00", "2026-08-01", PAID_AT],
        ["Total", "", "", "", "", "", "", "", "", "", "44.00", "", ""],
      ]);
      const result = await OrangeOscarPdfAdapter.parse(pdf, "oscar.pdf");
      expect(result.rows).toHaveLength(1); // la fila de pie nunca se cuenta como fila de datos
      expect(result.declaredTotal).toBe("44.00");
    });
  });

  describe("OrangeKaiserPdfAdapter (ORANGE_REFERRAL, sin Member ID)", () => {
    const headers = [
      "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
      "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
    ];

    it("E) parsea correctamente SIN columna Member ID; fija businessModality=REFERRAL", async () => {
      const pdf = buildTestTablePdf([
        headers,
        ["Nombre Kaiser", "Agent B", "GA", "Kaiser", "ACTIVE", "30.00", "1", "60.00", "0.00", "60.00", "2026-08-01", PAID_AT],
      ]);
      const result = await OrangeKaiserPdfAdapter.parse(pdf, "kaiser.pdf");
      expect(result.payerAgency).toBe("ORANGE");
      expect(result.businessModality).toBe("REFERRAL");
      expect(result.rows[0].externalMemberId).toBeNull();
      expect(result.rows[0].receivedAmount).toBe("60.00");
    });
  });

  describe("EliteBcbsPdfAdapter (ELITE_REFERRAL, con CLIENT DOB, sin Status)", () => {
    const headers = [
      "REPORT", "CARRIER", "MEMBER ID", "Agent", "CLIENT/TITLE", "CLIENT DOB", "STATE",
      "RATE", "EFFECTIVE DATE", "APPLICANTS", "SUBTOTAL", "ASISTENCIA", "TOTAL", "MONTH PAID",
    ];

    it("F) parsea el layout distinto de Elite (con DOB, sin Status); fija businessModality=REFERRAL siempre", async () => {
      const pdf = buildTestTablePdf([
        headers,
        ["RPT1", "BlueCross", uniqueName("ELM"), "Agent C", "Persona Elite", "1990-05-20", "SC", "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT],
      ]);
      const result = await EliteBcbsPdfAdapter.parse(pdf, "elite.pdf");
      expect(result.payerAgency).toBe("ELITE");
      expect(result.businessModality).toBe("REFERRAL");
      const row = result.rows[0];
      expect(row.status).toBeNull(); // este formato no reporta Status
      expect(row.dateOfBirth?.toISOString().slice(0, 10)).toBe("1990-05-20");
      expect(row.receivedAmount).toBe("80.00");
      expect(row.netAmount).toBe("75.00");
    });

    it("G) CLIENT DOB nunca se persiste en CommissionStatementRow — solo vive en memoria durante el matching", async () => {
      const pdf = buildTestTablePdf([
        headers,
        [
          "RPT1", "BlueCross", uniqueName("ELM"), "Agent C", uniqueName("Persona Elite Dos"), "1985-03-10", "SC",
          "40.00", "2026-08-01", "1", "80.00", "5.00", "75.00", PAID_AT,
        ],
      ]);
      const upload = await uploadCommissionStatement(admin, "ELITE_BCBS_PDF", makePdfFile(pdf, uniqueName("elite") + ".pdf"));
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
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
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
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
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
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
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
    const upload1 = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf1, uniqueName("oscar1") + ".pdf"));
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
    const upload2 = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf2, uniqueName("oscar2") + ".pdf"));
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
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(pdf, uniqueName("oscar") + ".pdf"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    await applyCommissionStatement(admin, upload.statementId);

    const payment = await prisma.commissionPayment.findFirstOrThrow({
      where: { commissionExpectation: { policyId: policy.id } },
      select: { amount: true },
    });
    expect(payment.amount.toFixed(2)).toBe("50.00"); // Subtotal, nunca Total (44.00) ni Asistencia (6.00)
  });
});
