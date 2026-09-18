import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPolicy } from "@/services/policies.service";
import { createCommissionRule, generateExpectationForPeriod } from "@/services/commission-rules.service";
import {
  uploadCommissionStatement,
  getCommissionStatementPreview,
  manualMatchStatementRow,
  applyCommissionStatement,
} from "./reconciliation.service";
import { listStatementSources, getStatementAdapter } from "./registry";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Fase 020 (§30, letras A-Y) — pipeline completo de conciliación:
// upload -> matching -> preview -> manual match -> apply -> idempotencia.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdRuleProductIds: string[] = [];
const createdStatementIds: string[] = [];

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
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makePerson(firstName: string, lastName: string) {
  const person = await prisma.person.create({
    data: { firstName, lastName, contactStatus: "CLIENT" },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeCarrier(name: string) {
  const carrier = await prisma.carrier.create({ data: { name } });
  createdCarrierIds.push(carrier.id);
  return carrier;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-recon");
  agent = await makeActor("AGENT", "agent-recon");
  assistant = await makeActor("ASSISTANT", "assistant-recon");
});

afterAll(async () => {
  // Fase 1.1 — CORRECCIÓN DE INCIDENTE: esta línea antes decía
  // `deleteMany({ where: { statementRowId: { not: null } } })`, SIN
  // acotar a los statements creados por esta prueba — borraba
  // CUALQUIER CommissionPayment real de la base de datos (de cualquier
  // origen), no solo los de este archivo de test. Permaneció dormido
  // porque nunca antes había CommissionPayment reales con
  // statementRowId en esta base de datos; al aplicarse comisiones
  // reales por primera vez (Fase 1.1), correr este test las borró
  // todas. SIEMPRE acotar la limpieza a los IDs que la propia prueba
  // creó, igual que el resto de este afterAll — nunca un deleteMany
  // sin filtro de pertenencia sobre una tabla que puede tener datos
  // reales.
  await prisma.commissionPayment.deleteMany({ where: { statementRow: { statementId: { in: createdStatementIds } } } });
  await prisma.commissionStatementRow.deleteMany({ where: { statementId: { in: createdStatementIds } } });
  await prisma.commissionStatement.deleteMany({ where: { id: { in: createdStatementIds } } });
  await prisma.policyExternalReference.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionExpectation.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.commissionRule.deleteMany({ where: { productId: { in: createdRuleProductIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

async function makePolicyWithExpectation(
  firstName: string,
  lastName: string,
  carrierNameOrId: { id: string; name: string } | string,
  expectedAmount: string,
  period: Date
) {
  const person = await makePerson(firstName, lastName);
  const carrier =
    typeof carrierNameOrId === "string" ? await makeCarrier(carrierNameOrId) : carrierNameOrId;
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Recon"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  // Fase 025.5.6 (UAT-22): effectiveDate SIEMPRE en el mismo año que el
  // período de la comisión que se va a conciliar — de lo contrario la
  // nueva validación de vigencia (computePeriodMatch) exige un motivo
  // administrativo explícito, cosa que estos tests no están probando
  // aquí (eso lo cubre pdf-import.service.test.ts).
  const policy = await createPolicy(admin, {
    holderId: person.id,
    productId: product.id,
    holderCovered: "false",
    effectiveDate: new Date(Date.UTC(period.getUTCFullYear(), 0, 1)),
    status: "ACTIVE",
  });
  createdPolicyIds.push(policy.id);
  createdRuleProductIds.push(product.id);

  await createCommissionRule(admin, {
    productId: product.id,
    method: "FIXED_AMOUNT",
    base: "FIXED",
    initialAmount: expectedAmount,
    initialPeriodicity: "MONTHLY",
  });
  const periodStr = `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
  const generated = await generateExpectationForPeriod(admin, { policyId: policy.id, period: periodStr });
  const expectationId = (generated as { expectationId: string }).expectationId;

  return { person, policy, expectationId };
}

function makeCsv(rows: string[]): string {
  const header = "Member ID,Name,Agent,Sale Type,State,Type,Carrier,Status,Rate,Members,Subtotal,Asistencia,Total,Effective Date,Paid At";
  return [header, ...rows].join("\n");
}

function makeFile(csv: string, name = "reporte.csv"): File {
  return new File([csv], name, { type: "text/csv" });
}

const PAID_AT = "08/15/2026";
const PAID_PERIOD = new Date(Date.UTC(2026, 7, 1));

describe("reconciliation.service — pipeline de conciliación", () => {
  it("G) external ID exacto: un match manual previo hace que la siguiente fila auto-matchee por PolicyExternalReference", async () => {
    const { policy, expectationId } = await makePolicyWithExpectation(
      "Viridiana",
      "Cabrales",
      uniqueName("Oscar"),
      "50.00",
      PAID_PERIOD
    );
    const memberId = uniqueName("OSC");

    // Primera subida: no hay referencia externa todavía, cae a AMBIGUOUS/UNMATCHED
    // según nombre — se resuelve manualmente.
    const csv1 = makeCsv([
      `${memberId},Viridiana Cabrales,Agent A,NEW,IL,HEALTH,${uniqueName("X")},ACTIVE,25,2,50,6,44,08/01/2026,${PAID_AT}`,
    ]);
    const upload1 = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv1, uniqueName("r") + ".csv"));
    if (upload1.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload1.statementId);

    const preview1 = await getCommissionStatementPreview(admin, upload1.statementId);
    const row1 = preview1.rows[0];
    expect(row1.matchStatus).toBe("UNMATCHED");

    await manualMatchStatementRow(admin, row1.id, { policyId: policy.id });

    const ref = await prisma.policyExternalReference.findFirst({ where: { externalId: memberId } });
    expect(ref?.policyId).toBe(policy.id);
    void expectationId;
  });

  it("H) nombre ambiguo (2 pólizas con el mismo nombre) nunca auto-matchea", async () => {
    const carrier = await makeCarrier(uniqueName("AmbiguousCarrier"));
    const sharedName = uniqueName("Shared Person");
    const [firstName, lastName] = ["Shared", sharedName];
    await makePolicyWithExpectation(firstName, lastName, carrier, "20.00", PAID_PERIOD);
    await makePolicyWithExpectation(firstName, lastName, carrier, "20.00", PAID_PERIOD);

    const csv = makeCsv([
      `${uniqueName("OSC")},${firstName} ${lastName},Agent A,NEW,NJ,HEALTH,${carrier.name},ACTIVE,20,1,20,0,20,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].matchStatus).toBe("AMBIGUOUS");
  });

  it("I) una fila UNMATCHED permanece revisable (no bloquea el resto del preview)", async () => {
    const csv = makeCsv([
      `${uniqueName("OSC")},Nadie Conocido,Agent A,NEW,IL,HEALTH,${uniqueName("Z")},ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    expect(preview.rows[0].matchStatus).toBe("UNMATCHED");
    // Fase 025.5.5 (UAT-21): PENDING_REVIEW reemplaza PREVIEW — sigue
    // habiendo filas accionables (esta UNMATCHED) y ninguna aplicada.
    expect(preview.statement.status).toBe("PENDING_REVIEW");
  });

  it("J) manual match resuelve una fila AMBIGUOUS/UNMATCHED hacia una póliza elegida", async () => {
    const { policy } = await makePolicyWithExpectation("Jaime", uniqueName("Rubio"), uniqueName("Oscar"), "25.00", PAID_PERIOD);
    const csv = makeCsv([
      `${uniqueName("OSC")},${uniqueName("Nombre Distinto")},Agent A,NEW,IL,HEALTH,${uniqueName("X")},ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    const preview1 = await getCommissionStatementPreview(admin, upload.statementId);
    const rowId = preview1.rows[0].id;

    const preview2 = await manualMatchStatementRow(admin, rowId, { policyId: policy.id });
    expect(preview2.rows[0].matchStatus).toBe("MATCHED");
    expect(preview2.rows[0].matchedPolicy?.id).toBe(policy.id);
  });

  it("K/L/M/N) expected vs received: MATCH, UNDERPAID, OVERPAID calculados correctamente", async () => {
    const carrier = await makeCarrier(uniqueName("Oscar"));
    const exact = await makePolicyWithExpectation("Exact", uniqueName("Match"), carrier, "25.00", PAID_PERIOD);
    const under = await makePolicyWithExpectation("Under", uniqueName("Paid"), carrier, "25.00", PAID_PERIOD);
    const over = await makePolicyWithExpectation("Over", uniqueName("Paid"), carrier, "25.00", PAID_PERIOD);

    const csv = makeCsv([
      `${uniqueName("OSC")},Exact ${exact.person.lastName},A,NEW,IL,HEALTH,${carrier.name},ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
      `${uniqueName("OSC")},Under ${under.person.lastName},A,NEW,IL,HEALTH,${carrier.name},ACTIVE,20,1,20,0,20,08/01/2026,${PAID_AT}`,
      `${uniqueName("OSC")},Over ${over.person.lastName},A,NEW,IL,HEALTH,${carrier.name},ACTIVE,30,1,30,0,30,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("unexpected duplicate");
    createdStatementIds.push(upload.statementId);
    const preview = await getCommissionStatementPreview(admin, upload.statementId);

    const byName = (n: string) => preview.rows.find((r) => r.displayName?.startsWith(n))!;
    expect(byName("Exact").reviewState).toBe("MATCH");
    expect(byName("Under").reviewState).toBe("UNDERPAID");
    expect(byName("Over").reviewState).toBe("OVERPAID");
  });

  it("O) partial payments: dos statements distintos suman hacia la misma expectativa", async () => {
    const { policy, expectationId } = await makePolicyWithExpectation(
      "Partial",
      uniqueName("Payer"),
      uniqueName("Oscar"),
      "50.00",
      PAID_PERIOD
    );

    const csvA = makeCsv([
      `${uniqueName("OSCA")},Partial X,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const uploadA = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csvA, uniqueName("a") + ".csv"));
    if (uploadA.duplicate) throw new Error("dup");
    createdStatementIds.push(uploadA.statementId);
    const previewA = await getCommissionStatementPreview(admin, uploadA.statementId);
    await manualMatchStatementRow(admin, previewA.rows[0].id, { policyId: policy.id });
    await applyCommissionStatement(admin, uploadA.statementId);

    const csvB = makeCsv([
      `${uniqueName("OSCB")},Partial Y,A,NEW,IL,HEALTH,Y,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const uploadB = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csvB, uniqueName("b") + ".csv"));
    if (uploadB.duplicate) throw new Error("dup");
    createdStatementIds.push(uploadB.statementId);
    const previewB = await getCommissionStatementPreview(admin, uploadB.statementId);
    await manualMatchStatementRow(admin, previewB.rows[0].id, { policyId: policy.id });
    await applyCommissionStatement(admin, uploadB.statementId);

    const payments = await prisma.commissionPayment.findMany({ where: { commissionExpectationId: expectationId } });
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);
    expect(total).toBe(50);
  });

  it("P) mismo statement subido dos veces se detecta como duplicado (mismo contenido, distinto nombre de archivo)", async () => {
    const csv = makeCsv([
      `${uniqueName("OSC")},Duplicate Test,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const first = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, "archivo-original.csv"));
    if (first.duplicate) throw new Error("unexpected duplicate on first upload");
    createdStatementIds.push(first.statementId);

    const second = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, "archivo-renombrado.csv"));
    expect(second.duplicate).toBe(true);
    if (second.duplicate) expect(second.existingStatementId).toBe(first.statementId);
  });

  it("Q/Y) apply es idempotente — aplicar dos veces el mismo statement no duplica pagos", async () => {
    const { policy, expectationId } = await makePolicyWithExpectation(
      "Idempotent",
      uniqueName("Test"),
      uniqueName("Oscar"),
      "25.00",
      PAID_PERIOD
    );
    const csv = makeCsv([
      `${uniqueName("OSC")},Idempotent X,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("dup");
    createdStatementIds.push(upload.statementId);
    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    await manualMatchStatementRow(admin, preview.rows[0].id, { policyId: policy.id });

    await applyCommissionStatement(admin, upload.statementId);
    await applyCommissionStatement(admin, upload.statementId); // segunda vez

    const payments = await prisma.commissionPayment.findMany({ where: { commissionExpectationId: expectationId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toString()).toBe("25");
  });

  it("R/S) apply crea CommissionPayment tipo PAYMENT con el monto de la fila", async () => {
    const { policy, expectationId } = await makePolicyWithExpectation(
      "Payment",
      uniqueName("Created"),
      uniqueName("Oscar"),
      "25.00",
      PAID_PERIOD
    );
    const csv = makeCsv([
      `${uniqueName("OSC")},Payment X,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`,
    ]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("dup");
    createdStatementIds.push(upload.statementId);
    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    await manualMatchStatementRow(admin, preview.rows[0].id, { policyId: policy.id });
    await applyCommissionStatement(admin, upload.statementId);

    const payment = await prisma.commissionPayment.findFirst({ where: { commissionExpectationId: expectationId } });
    expect(payment?.type).toBe("PAYMENT");
    expect(payment?.amount.toString()).toBe("25");
  });

  it("T/U/V) autorización: ADMIN puede subir/aplicar, AGENT no puede aplicar, ASSISTANT sin acceso", async () => {
    const csv = makeCsv([`${uniqueName("OSC")},Auth Test,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`]);

    await expect(
      uploadCommissionStatement(agent, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      uploadCommissionStatement(assistant, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("dup");
    createdStatementIds.push(upload.statementId);

    await expect(applyCommissionStatement(agent, upload.statementId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(applyCommissionStatement(assistant, upload.statementId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("W/X) COMMISSION_STATEMENT_UPLOAD y COMMISSION_PAYMENT_FROM_STATEMENT se auditan sin exponer montos en el resumen", async () => {
    const { policy } = await makePolicyWithExpectation("Audit", uniqueName("Test"), uniqueName("Oscar"), "25.00", PAID_PERIOD);
    const csv = makeCsv([`${uniqueName("OSC")},Audit X,A,NEW,IL,HEALTH,X,ACTIVE,25,1,25,0,25,08/01/2026,${PAID_AT}`]);
    const upload = await uploadCommissionStatement(admin, "ORANGE_OSCAR", makeFile(csv, uniqueName("r") + ".csv"));
    if (upload.duplicate) throw new Error("dup");
    createdStatementIds.push(upload.statementId);

    const uploadEvent = await prisma.auditEvent.findFirst({
      where: { entityType: "CommissionStatement", entityId: upload.statementId, action: "COMMISSION_STATEMENT_UPLOAD" },
    });
    expect(uploadEvent).toBeTruthy();
    expect(uploadEvent?.summary).not.toMatch(/\$?\d+\.\d{2}/);

    const preview = await getCommissionStatementPreview(admin, upload.statementId);
    await manualMatchStatementRow(admin, preview.rows[0].id, { policyId: policy.id });
    await applyCommissionStatement(admin, upload.statementId);

    const paymentEvent = await prisma.auditEvent.findFirst({
      where: { entityType: "CommissionPayment", action: "COMMISSION_PAYMENT_FROM_STATEMENT", policyId: policy.id },
    });
    expect(paymentEvent).toBeTruthy();
    expect(JSON.stringify(paymentEvent?.changes ?? {})).not.toContain("25");
  });

  // Fase 025.4 (UAT-05) — subida segura de PDF. Fase 025.5.3: el
  // catálogo de fuentes es exclusivamente AGENCIA+MODALIDAD
  // (ORANGE_OWN, ORANGE_REFERRAL, ELITE_REFERRAL) — nunca un carrier;
  // ya no existe ningún adaptador "pendiente" (Ambetter y cualquier
  // otro carrier bajo una modalidad ya soportada usan el mismo adapter
  // genérico, ver orange-pdf-shared.ts).
  describe("UAT-05 — subida segura de PDF (Fase 025.5.3: fuentes = agencia+modalidad, nunca carrier)", () => {
    function makePdfFile(name: string): File {
      // Firma real %PDF- (mínimo válido para sniffMimeType) + relleno
      // sin las columnas esperadas — el archivo SÍ es un PDF real, pero
      // su contenido no tiene la estructura de ningún adapter.
      const bytes = new TextEncoder().encode("%PDF-1.4\n%fake content for test\n");
      return new File([bytes], name, { type: "application/pdf" });
    }

    it("el catálogo de reportes PDF reales contiene EXACTAMENTE 3 fuentes agencia+modalidad, ninguna nombrada por carrier", () => {
      const sources = listStatementSources();
      const pdfModalitySources = sources.filter((s) => ["ORANGE_OWN", "ORANGE_REFERRAL", "ELITE_REFERRAL"].includes(s.source));
      expect(pdfModalitySources.map((s) => s.source).sort()).toEqual(["ELITE_REFERRAL", "ORANGE_OWN", "ORANGE_REFERRAL"]);
      // Ningún carrier (Oscar/Kaiser/BCBS/Ambetter/Cigna) aparece como
      // id ni en la etiqueta visible de estas 3 fuentes — son datos
      // detectados del contenido, nunca opciones del selector. (El
      // adapter CSV legacy de Fase 020, ORANGE_OSCAR, queda deliberadamente
      // fuera de esta verificación: es un flujo previo no alcanzado por
      // esta corrección de UI.)
      const carrierNames = ["OSCAR", "KAISER", "BCBS", "AMBETTER", "CIGNA"];
      for (const s of pdfModalitySources) {
        for (const carrierName of carrierNames) {
          expect(s.source.toUpperCase()).not.toContain(carrierName);
          expect(s.label.toUpperCase()).not.toContain(carrierName);
        }
      }
    });

    it("Fase 025.5.5 (UAT-20): el selector de NUEVAS importaciones excluye la fuente legacy ORANGE_OSCAR — muestra EXACTAMENTE las 3 modalidades PDF con sus valores técnicos y etiquetas", () => {
      const sources = listStatementSources();
      expect(sources.map((s) => s.source).sort()).toEqual(["ELITE_REFERRAL", "ORANGE_OWN", "ORANGE_REFERRAL"]);
      expect(sources.find((s) => s.source === "ORANGE_OWN")?.label).toBe("Orange — Propias");
      expect(sources.find((s) => s.source === "ORANGE_REFERRAL")?.label).toBe("Orange — Referidas");
      expect(sources.find((s) => s.source === "ELITE_REFERRAL")?.label).toBe("Elite — Referidas");
      expect(sources.some((s) => s.source === "ORANGE_OSCAR")).toBe(false);
    });

    it("Fase 025.5.5 (UAT-20): ORANGE_OSCAR sigue siendo resoluble vía getStatementAdapter (necesario para interpretar importaciones históricas ya existentes) aunque no aparezca en el selector de nuevas importaciones", () => {
      expect(getStatementAdapter("ORANGE_OSCAR")).not.toBeNull();
      expect(listStatementSources({ includeLegacy: true }).some((s) => s.source === "ORANGE_OSCAR")).toBe(true);
    });

    it("un PDF con firma válida pero sin estructura real de PDF es aceptado en la subida y rechazado con un mensaje claro al parsear", async () => {
      // Firma %PDF- real, pero no un PDF bien formado (sin xref/objetos)
      // — pasa la validación de firma pero pdfjs no puede leerlo; en
      // cualquier caso nunca se llega a crear un CommissionStatement.
      await expect(
        uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(uniqueName("r") + ".pdf"))
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("file:") });
    });

    it("un archivo que NO es un PDF real (firma inválida) se rechaza ANTES de llegar a cualquier adaptador", async () => {
      const fakeBytes = new TextEncoder().encode("esto no es un pdf de verdad");
      const fake = new File([fakeBytes], uniqueName("r") + ".pdf", { type: "application/pdf" });
      await expect(uploadCommissionStatement(admin, "ORANGE_OWN", fake)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("no es un PDF válido"),
      });
    });

    it("nunca se crea un CommissionStatement cuando el parseo falla (contenido sin las columnas esperadas)", async () => {
      const before = await prisma.commissionStatement.count({ where: { source: "ORANGE_OWN" } });
      await expect(
        uploadCommissionStatement(admin, "ORANGE_OWN", makePdfFile(uniqueName("r") + ".pdf"))
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const after = await prisma.commissionStatement.count({ where: { source: "ORANGE_OWN" } });
      expect(after).toBe(before);
    });

    it("una fuente inexistente/retirada (ej. un id acoplado a carrier ya reemplazado) se rechaza como no soportada", async () => {
      await expect(
        uploadCommissionStatement(admin, "ORANGE_OSCAR_PDF", makePdfFile(uniqueName("r") + ".pdf"))
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("no soportada") });
    });

    it("ASSISTANT sigue sin acceso, ni siquiera para intentar un PDF", async () => {
      await expect(
        uploadCommissionStatement(assistant, "ORANGE_OWN", makePdfFile(uniqueName("r") + ".pdf"))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
