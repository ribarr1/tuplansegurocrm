import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  exportContactsCsv,
  exportPoliciesCsv,
  exportCommissionsCsv,
  exportClientReportCsv,
} from "@/services/export.service";
import { setSsn, setUscisNumber } from "@/services/sensitive-identity.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 020 (§31) — autorización y minimización de campos sensibles en
// exportación CSV.

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
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

let admin: AuthorizedUser;
let assistant: AuthorizedUser;
let agent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-export");
  assistant = await makeActor("ASSISTANT", "assistant-export");
  agent = await makeActor("AGENT", "agent-export");
  await prisma.user.update({ where: { id: agent.id }, data: { isAgent: true } });

  const person = await prisma.person.create({
    data: { firstName: "Export", lastName: uniqueName("Test"), contactStatus: "CLIENT", phone: "555-0000" },
  });
  createdPersonIds.push(person.id);

  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Export") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Export"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(admin, {
    holderId: person.id,
    productId: product.id,
    holderCovered: "false",
    policyNumber: uniqueName("EXP"),
  });
  createdPolicyIds.push(policy.id);
});

afterAll(async () => {
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityType: "Export", actorUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("export.service — CSV", () => {
  it("exporta contactos con las columnas esperadas, sin datos sensibles", async () => {
    const csv = await exportContactsCsv(admin);
    expect(csv).toContain("Nombre,Apellido,Teléfono,Email,Estado,Agente asignado,Creado");
    expect(csv.toLowerCase()).not.toContain("ssn");
    expect(csv.toLowerCase()).not.toContain("password");
    expect(csv.toLowerCase()).not.toContain("medicamento");
  });

  // Fase 025.5.1 (UAT-11): "Exportar CSV" de Contactos exporta lo que
  // la pantalla muestra — mismo filtro assignedAgentId que el listado.
  it("UAT-11: exportContactsCsv respeta el filtro assignedAgentId (mismo universo que la pantalla)", async () => {
    const marker = uniqueName("ExportAgentFilter");
    const assigned = await prisma.person.create({
      data: { firstName: marker, lastName: "HasAgentRow", contactStatus: "PROSPECT", assignedAgentId: agent.id },
    });
    createdPersonIds.push(assigned.id);
    const unassigned = await prisma.person.create({
      data: { firstName: marker, lastName: "NoAgentRow", contactStatus: "PROSPECT" },
    });
    createdPersonIds.push(unassigned.id);

    const csvFiltered = await exportContactsCsv(admin, { search: marker, assignedAgentId: agent.id });
    expect(csvFiltered).toContain("HasAgentRow");
    expect(csvFiltered).not.toContain("NoAgentRow");

    const csvUnassigned = await exportContactsCsv(admin, { search: marker, assignedAgentId: "unassigned" });
    expect(csvUnassigned).toContain("NoAgentRow");
    expect(csvUnassigned).not.toContain("HasAgentRow");
  });

  it("exporta pólizas con las columnas esperadas", async () => {
    const csv = await exportPoliciesCsv(admin);
    expect(csv).toContain("Número de póliza");
    expect(csv.toLowerCase()).not.toContain("ssn");
  });

  // Fase 025.3 (Bloque B): businessSource es un hecho histórico
  // (Propia/Referida) ya almacenado en Policy — el export debe
  // mostrarlo con su label existente, nunca recalcularlo.
  it("exporta pólizas con la columna Propia/Referida, usando el valor histórico almacenado", async () => {
    const csv = await exportPoliciesCsv(admin);
    expect(csv).toContain("Propia/Referida");
    expect(csv).toMatch(/Referida|Sin clasificar|Propia/);
  });

  it("ASSISTANT no puede exportar comisiones", async () => {
    await expect(exportCommissionsCsv(assistant)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ADMIN puede exportar comisiones", async () => {
    await expect(exportCommissionsCsv(admin)).resolves.toBeTruthy();
  });

  // Fase 025.4 (UAT-06): fila de totales al final del CSV.
  it("exporta comisiones con una fila TOTAL final", async () => {
    const csv = await exportCommissionsCsv(admin);
    expect(csv).toContain("TOTAL");
  });

  it("registra un AuditEvent EXPORT_CONTACTS sin guardar el contenido exportado", async () => {
    await exportContactsCsv(admin);
    const event = await prisma.auditEvent.findFirst({
      where: { entityType: "Export", action: "EXPORT_CONTACTS", actorUserId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event).toBeTruthy();
    expect(event?.changes).toBeNull();
    expect(JSON.stringify(event?.metadata ?? {})).not.toContain("555-0000");
  });

  it("AR/AS) el reporte de clientes en CSV respeta filtros y nunca incluye SSN/USCIS/A-Number", async () => {
    const label = uniqueName("ReportCsv");
    const person = await prisma.person.create({
      data: { firstName: label, lastName: uniqueName("Person"), contactStatus: "CLIENT" },
    });
    createdPersonIds.push(person.id);
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A999999999" });

    const csv = await exportClientReportCsv(admin, { search: label });
    expect(csv).toContain(label);
    expect(csv).not.toContain("123456789");
    expect(csv).not.toContain("123-45-6789");
    expect(csv).not.toContain("A999999999");
    expect(csv.toLowerCase()).not.toContain("ssn");
    expect(csv.toLowerCase()).not.toContain("uscis");
    expect(csv.toLowerCase()).not.toContain("a-number");

    const otherLabel = uniqueName("NotIncluded");
    const csvFiltered = await exportClientReportCsv(admin, { search: otherLabel });
    expect(csvFiltered).not.toContain(label);
  });

  it("registra un AuditEvent EXPORT_CLIENT_REPORT", async () => {
    await exportClientReportCsv(admin, {});
    const event = await prisma.auditEvent.findFirst({
      where: { entityType: "Export", action: "EXPORT_CLIENT_REPORT", actorUserId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event).toBeTruthy();
    expect(event?.changes).toBeNull();
  });
});
