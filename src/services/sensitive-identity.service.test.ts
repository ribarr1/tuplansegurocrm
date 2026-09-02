import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getSensitiveIdentitySummary,
  updateImmigrationCategory,
  setSsn,
  removeSsn,
  revealSsn,
  setUscisNumber,
  removeUscisNumber,
  revealUscisNumber,
  createImmigrationDocument,
  updateImmigrationDocument,
  deactivateImmigrationDocument,
  revealImmigrationDocumentNumber,
} from "@/services/sensitive-identity.service";
import { AppError } from "@/services/errors";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 021: SSN/USCIS/A-Number/documentos migratorios cifrados pero
// recuperables. Letras referenciadas en comentarios corresponden a la
// ficha (§45 SSN/crypto, §46 inmigración). Las letras puramente de
// formato/crypto puro (A, B, D, E, F, G, H parcial) ya están cubiertas
// en sensitive-identity-format.test.ts y pii-crypto.test.ts — aquí solo
// lo que requiere la capa de servicio (autorización, auditoría, DB).

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];

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
      lastName: `Sensitive${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-sensid");
  agent = await makeActor("AGENT", "agent-sensid");
  agentB = await makeActor("AGENT", "agentb-sensid");
  assistant = await makeActor("ASSISTANT", "assistant-sensid");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { contactPersonId: { in: createdPersonIds } } });
  await prisma.personImmigrationDocument.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.personSensitiveIdentity.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("sensitive-identity.service — SSN", () => {
  it("B) rechaza un SSN con formato inválido", async () => {
    const person = await makePerson();
    await expect(setSsn(admin, { personId: person.id, ssn: "123-45-678" })).rejects.toThrow(AppError);
  });

  it("C) la base de datos nunca contiene el SSN en texto plano", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const row = await prisma.personSensitiveIdentity.findUniqueOrThrow({ where: { personId: person.id } });
    expect(row.ssnEncrypted).not.toContain("123456789");
    expect(row.ssnEncrypted).not.toBe("123456789");
  });

  it("H) el resumen enmascarado muestra ***-**-6789, nunca el valor completo", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.ssn.masked).toBe("***-**-6789");
    expect(JSON.stringify(summary)).not.toContain("123456789");
  });

  it("R) el DTO del resumen nunca incluye el valor completo del SSN", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "987-65-4321" });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(Object.keys(summary.ssn)).toEqual(["hasValue", "masked"]);
  });

  it("I) ADMIN puede revelar el SSN completo", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const full = await revealSsn(admin, { personId: person.id });
    expect(full).toBe("123-45-6789");
  });

  it("J) un AGENT con acceso operativo puede revelar el SSN", async () => {
    const person = await makePerson(agent.id);
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const full = await revealSsn(agent, { personId: person.id });
    expect(full).toBe("123-45-6789");
  });

  it("K) un AGENT sin acceso operativo NO puede revelar el SSN", async () => {
    const person = await makePerson(agentB.id);
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    await expect(revealSsn(agent, { personId: person.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("L) ASSISTANT nunca puede revelar el SSN, aunque pueda ver el resumen masked", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    const summary = await getSensitiveIdentitySummary(assistant, person.id);
    expect(summary.ssn.masked).toBe("***-**-6789");
    expect(summary.canReveal).toBe(false);
    await expect(revealSsn(assistant, { personId: person.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("M/N) revelar el SSN genera un AuditEvent SSN_REVEALED sin el valor en claro", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    await revealSsn(admin, { personId: person.id });
    const events = await prisma.auditEvent.findMany({
      where: { contactPersonId: person.id, action: "SSN_REVEALED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).not.toContain("123456789");
    expect(events[0].summary).not.toContain("123-45-6789");
    expect(events[0].changes).toBeNull();
  });

  it("SSN_SET vs SSN_UPDATE: la primera vez audita SET, la siguiente UPDATE", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    await setSsn(admin, { personId: person.id, ssn: "111-22-3333" });
    const events = await prisma.auditEvent.findMany({
      where: { contactPersonId: person.id, entityType: "PersonSensitiveIdentity", action: { in: ["SSN_SET", "SSN_UPDATE"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["SSN_SET", "SSN_UPDATE"]);
  });

  it("S) eliminar el SSN se audita sin guardar el valor anterior", async () => {
    const person = await makePerson();
    await setSsn(admin, { personId: person.id, ssn: "123-45-6789" });
    await removeSsn(admin, { personId: person.id });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.ssn.hasValue).toBe(false);
    const events = await prisma.auditEvent.findMany({
      where: { contactPersonId: person.id, action: "SSN_REMOVED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).not.toContain("123456789");
    await expect(revealSsn(admin, { personId: person.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rechaza eliminar un SSN que no existe", async () => {
    const person = await makePerson();
    await expect(removeSsn(admin, { personId: person.id })).rejects.toThrow(AppError);
  });
});

describe("sensitive-identity.service — USCIS/A-Number", () => {
  it("X) la base de datos nunca contiene el USCIS/A-Number en texto plano", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    const row = await prisma.personSensitiveIdentity.findUniqueOrThrow({ where: { personId: person.id } });
    expect(row.uscisNumberEncrypted).not.toContain("A123456789");
  });

  it("Z) el resumen muestra *****6789, nunca el valor completo", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.uscisNumber.masked).toBe("*****6789");
  });

  it("AA) ADMIN puede revelar el USCIS/A-Number", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    expect(await revealUscisNumber(admin, { personId: person.id })).toBe("A123456789");
  });

  it("AB) un AGENT con acceso puede revelar el USCIS/A-Number", async () => {
    const person = await makePerson(agent.id);
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    expect(await revealUscisNumber(agent, { personId: person.id })).toBe("A123456789");
  });

  it("AC) ASSISTANT nunca puede revelar el USCIS/A-Number", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    await expect(revealUscisNumber(assistant, { personId: person.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("AD) revelar el USCIS/A-Number audita sin el valor en claro", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    await revealUscisNumber(admin, { personId: person.id });
    const events = await prisma.auditEvent.findMany({
      where: { contactPersonId: person.id, action: "USCIS_REVEALED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).not.toContain("A123456789");
  });

  it("eliminar el USCIS/A-Number se audita sin guardar el valor anterior", async () => {
    const person = await makePerson();
    await setUscisNumber(admin, { personId: person.id, uscisNumber: "A123456789" });
    await removeUscisNumber(admin, { personId: person.id });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.uscisNumber.hasValue).toBe(false);
  });
});

describe("sensitive-identity.service — categoría migratoria", () => {
  it("T) crear/actualizar la categoría migratoria se audita con el valor antes/después (no sensible)", async () => {
    const person = await makePerson();
    await updateImmigrationCategory(admin, { personId: person.id, immigrationCategory: "LAWFUL_PERMANENT_RESIDENT" });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.immigrationCategory).toBe("LAWFUL_PERMANENT_RESIDENT");
    const events = await prisma.auditEvent.findMany({
      where: { contactPersonId: person.id, action: "IMMIGRATION_CATEGORY_UPDATE" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].changes).toMatchObject({
      immigrationCategory: { before: "UNKNOWN", after: "LAWFUL_PERMANENT_RESIDENT" },
    });
  });

  it("ASSISTANT no puede actualizar la categoría migratoria", async () => {
    const person = await makePerson();
    await expect(
      updateImmigrationCategory(assistant, { personId: person.id, immigrationCategory: "US_CITIZEN" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("sensitive-identity.service — documentos migratorios", () => {
  it("U) crea un documento de residente permanente con número", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "PERMANENT_RESIDENT_CARD",
      documentNumber: "RC9876",
      expirationDate: "2032-08-15",
    });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.documents).toHaveLength(1);
    expect(summary.documents[0].documentType).toBe("PERMANENT_RESIDENT_CARD");
    expect(summary.documents[0].documentNumberMasked).toBe("******9876");
    void doc;
  });

  it("V) crea un documento EAD (permiso de trabajo)", async () => {
    const person = await makePerson();
    await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "EMPLOYMENT_AUTHORIZATION_DOCUMENT",
      documentNumber: "EAD1234",
    });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.documents[0].documentType).toBe("EMPLOYMENT_AUTHORIZATION_DOCUMENT");
  });

  it("W) crea un documento sin fecha de vencimiento (opcional)", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
    });
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.documents[0].expirationDate).toBeNull();
    void doc;
  });

  it("Y) el número de documento nunca se guarda en texto plano en la base de datos", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "PLAINTEXT9999",
    });
    const row = await prisma.personImmigrationDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.documentNumberEncrypted).not.toContain("PLAINTEXT9999");
  });

  it("AA/AB/AC) revelar el número de documento respeta la misma autorización (ADMIN sí, ASSISTANT no)", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "SECRET123",
    });
    expect(await revealImmigrationDocumentNumber(admin, doc.id)).toBe("SECRET123");
    await expect(revealImmigrationDocumentNumber(assistant, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("AD) revelar el número de documento se audita sin el valor en claro", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "SECRET456",
    });
    await revealImmigrationDocumentNumber(admin, doc.id);
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "PersonImmigrationDocument", entityId: doc.id, action: "IMMIGRATION_DOCUMENT_REVEALED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).not.toContain("SECRET456");
  });

  it("AH) actualizar un documento sin enviar documentNumber nunca lo toca ni lo descifra", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "ORIGINAL999",
    });
    await updateImmigrationDocument(admin, doc.id, { expirationDate: "2030-01-01" });
    expect(await revealImmigrationDocumentNumber(admin, doc.id)).toBe("ORIGINAL999");
  });

  it("actualizar un documento con un nuevo documentNumber lo reemplaza", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "OLD0001",
    });
    await updateImmigrationDocument(admin, doc.id, { documentNumber: "NEW0002" });
    expect(await revealImmigrationDocumentNumber(admin, doc.id)).toBe("NEW0002");
  });

  it("el diff auditado de una actualización nunca incluye el número de documento", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "OLD0003",
    });
    await updateImmigrationDocument(admin, doc.id, { documentNumber: "NEW0004", expirationDate: "2031-01-01" });
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "PersonImmigrationDocument", entityId: doc.id, action: "IMMIGRATION_DOCUMENT_UPDATE" },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].changes)).not.toContain("0003");
    expect(JSON.stringify(events[0].changes)).not.toContain("0004");
  });

  it("AE) desactivar un documento preserva su historial (no lo borra)", async () => {
    const person = await makePerson();
    const doc = await createImmigrationDocument(admin, {
      personId: person.id,
      documentType: "OTHER",
      documentNumber: "KEEP0005",
    });
    await deactivateImmigrationDocument(admin, doc.id);
    const summary = await getSensitiveIdentitySummary(admin, person.id);
    expect(summary.documents).toHaveLength(0);
    const stillExists = await prisma.personImmigrationDocument.findUnique({ where: { id: doc.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.isActive).toBe(false);
    expect(await revealImmigrationDocumentNumber(admin, doc.id)).toBe("KEEP0005");
  });

  it("ASSISTANT no puede crear un documento migratorio", async () => {
    const person = await makePerson();
    await expect(
      createImmigrationDocument(assistant, { personId: person.id, documentType: "OTHER" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
