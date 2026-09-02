import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { exportContactsCsv, exportPoliciesCsv, exportCommissionsCsv } from "@/services/export.service";
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
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

let admin: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-export");
  assistant = await makeActor("ASSISTANT", "assistant-export");

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

  it("exporta pólizas con las columnas esperadas", async () => {
    const csv = await exportPoliciesCsv(admin);
    expect(csv).toContain("Número de póliza");
    expect(csv.toLowerCase()).not.toContain("ssn");
  });

  it("ASSISTANT no puede exportar comisiones", async () => {
    await expect(exportCommissionsCsv(assistant)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ADMIN puede exportar comisiones", async () => {
    await expect(exportCommissionsCsv(admin)).resolves.toBeTruthy();
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
});
