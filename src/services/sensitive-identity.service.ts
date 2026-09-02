import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import {
  personIdParamSchema,
  personIdOnlySchema,
  immigrationDocumentIdSchema,
  updateImmigrationCategorySchema,
  setSsnSchema,
  setUscisNumberSchema,
  createImmigrationDocumentSchema,
  updateImmigrationDocumentSchema,
} from "@/schemas/sensitive-identity.schema";
import { encryptPii, decryptPii } from "@/lib/pii-crypto";
import {
  normalizeSsn,
  last4,
  maskSsn,
  formatSsnFull,
  normalizeIdentifier,
  maskUscisNumber,
  maskDocumentNumber,
} from "@/lib/sensitive-identity-format";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Identidad sensible del contacto (SSN, información migratoria) —
// Fase 021 (§1-§30 de la ficha).
//
// Información ADMINISTRATIVA proporcionada para operaciones de
// seguros — este módulo nunca determina jurídicamente el estatus
// migratorio de una persona, y ImmigrationCategory nunca se usa aquí
// (ni en ningún otro lugar del CRM) para concluir automáticamente
// elegibilidad de Marketplace/subsidio/Medicaid (ver docs/DECISIONS.md).
//
// Autorización DELIBERADAMENTE más estricta que canEditPerson (§15-§16
// de la ficha: "no reutilizar canViewContact() para reveal de PII").
// Dos niveles:
//   - Ver (masked): mismo criterio que canEditPerson (ADMIN/ASSISTANT
//     sin restricción, AGENT solo con acceso operativo al contacto).
//   - Gestionar (registrar/editar/eliminar/revelar/copiar): ADMIN
//     siempre, AGENT solo con acceso operativo, ASSISTANT NUNCA — ni
//     siquiera para los campos no sensibles de este módulo (categoría
//     migratoria, crear/editar un documento). Ver getSensitiveIdentitySummary
//     vs. el resto de funciones de este archivo.
// ---------------------------------------------------------------------------

async function loadPersonForAccessCheck(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

function assertCanViewSensitiveIdentity(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): void {
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }
}

// El gate real de PII altamente sensible — nunca delega en
// canEditPerson. ASSISTANT siempre false aquí, aunque canEditPerson lo
// trate como sin restricción para el resto del contacto.
export function canAccessSensitiveIdentity(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "AGENT") {
    return person.assignedAgentId === null || person.assignedAgentId === actor.id;
  }
  return false;
}

function assertCanManageSensitiveIdentity(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): void {
  if (!canAccessSensitiveIdentity(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes autorización para gestionar esta información sensible.");
  }
}

const SENSITIVE_IDENTITY_AUDIT_FIELDS = ["immigrationCategory"] as const;
const IMMIGRATION_DOCUMENT_AUDIT_FIELDS = ["documentType", "issuedDate", "expirationDate"] as const;

async function getOrCreateSensitiveIdentityRow(tx: Prisma.TransactionClient, personId: string) {
  return tx.personSensitiveIdentity.upsert({
    where: { personId },
    create: { personId },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Resumen enmascarado — ÚNICA función de este archivo con el gate de
// "ver" en vez de "gestionar" (§17 de la ficha: el Server Component de
// Contact Detail nunca debe descifrar/enviar el valor completo al
// cargar la página, solo masked/last4/hasValue).
// ---------------------------------------------------------------------------

export async function getSensitiveIdentitySummary(actor: AuthorizedUser, rawPersonId: unknown) {
  const personId = parseOrThrow(personIdParamSchema, rawPersonId);
  const person = await loadPersonForAccessCheck(personId);
  assertCanViewSensitiveIdentity(actor, person);

  const [identity, documents] = await Promise.all([
    prisma.personSensitiveIdentity.findUnique({
      where: { personId },
      select: { immigrationCategory: true, ssnLast4: true, uscisNumberLast4: true },
    }),
    prisma.personImmigrationDocument.findMany({
      where: { personId, isActive: true },
      select: {
        id: true,
        documentType: true,
        documentNumberLast4: true,
        issuedDate: true,
        expirationDate: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    personId,
    immigrationCategory: identity?.immigrationCategory ?? "UNKNOWN",
    ssn: {
      hasValue: Boolean(identity?.ssnLast4),
      masked: identity?.ssnLast4 ? maskSsn(identity.ssnLast4) : null,
    },
    uscisNumber: {
      hasValue: Boolean(identity?.uscisNumberLast4),
      masked: identity?.uscisNumberLast4 ? maskUscisNumber(identity.uscisNumberLast4) : null,
    },
    // canReveal informa a la UI si mostrar el botón "Mostrar" —
    // ASSISTANT (o un AGENT sin acceso) recibe canReveal=false aunque
    // haya llegado hasta aquí vía el gate de "ver".
    canReveal: canAccessSensitiveIdentity(actor, person),
    documents: documents.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      hasDocumentNumber: Boolean(d.documentNumberLast4),
      documentNumberMasked: d.documentNumberLast4 ? maskDocumentNumber(d.documentNumberLast4) : null,
      issuedDate: d.issuedDate,
      expirationDate: d.expirationDate,
    })),
  };
}

// ---------------------------------------------------------------------------
// Categoría migratoria
// ---------------------------------------------------------------------------

export async function updateImmigrationCategory(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(updateImmigrationCategorySchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, immigrationCategory: true },
  });

  const changes = buildDiff(
    { immigrationCategory: existing?.immigrationCategory ?? "UNKNOWN" },
    { immigrationCategory: input.immigrationCategory },
    SENSITIVE_IDENTITY_AUDIT_FIELDS
  );
  if (!changes) return getSensitiveIdentitySummary(actor, input.personId);

  await prisma.$transaction(async (tx) => {
    const row = await getOrCreateSensitiveIdentityRow(tx, input.personId);
    await tx.personSensitiveIdentity.update({
      where: { id: row.id },
      data: { immigrationCategory: input.immigrationCategory },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonSensitiveIdentity",
      entityId: row.id,
      action: "IMMIGRATION_CATEGORY_UPDATE",
      contactPersonId: input.personId,
      summary: "Categoría migratoria actualizada",
      changes,
    });
  });
  return getSensitiveIdentitySummary(actor, input.personId);
}

// ---------------------------------------------------------------------------
// SSN
// ---------------------------------------------------------------------------

export async function setSsn(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(setSsnSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const normalized = normalizeSsn(input.ssn);
  if (!normalized) throw new AppError("VALIDATION_ERROR", "ssn: El SSN debe tener 9 dígitos.");
  const ssnLast4 = last4(normalized);
  const ssnEncrypted = encryptPii(normalized);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, ssnLast4: true },
  });
  const isUpdate = Boolean(existing?.ssnLast4);

  await prisma.$transaction(async (tx) => {
    const row = await getOrCreateSensitiveIdentityRow(tx, input.personId);
    await tx.personSensitiveIdentity.update({ where: { id: row.id }, data: { ssnEncrypted, ssnLast4 } });
    // Nunca se guarda el SSN ni siquiera parcial en el audit log — solo
    // el hecho semántico de que se registró/actualizó (§14, §27 de la
    // ficha).
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonSensitiveIdentity",
      entityId: row.id,
      action: isUpdate ? "SSN_UPDATE" : "SSN_SET",
      contactPersonId: input.personId,
      summary: isUpdate ? "SSN actualizado" : "SSN registrado",
    });
  });
  return getSensitiveIdentitySummary(actor, input.personId);
}

export async function removeSsn(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(personIdOnlySchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, ssnLast4: true },
  });
  if (!existing?.ssnLast4) throw new AppError("VALIDATION_ERROR", "No hay SSN registrado para eliminar.");

  await prisma.$transaction(async (tx) => {
    await tx.personSensitiveIdentity.update({
      where: { id: existing.id },
      data: { ssnEncrypted: null, ssnLast4: null },
    });
    // Nunca se guarda el valor anterior — solo el hecho de que se eliminó.
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonSensitiveIdentity",
      entityId: existing.id,
      action: "SSN_REMOVED",
      contactPersonId: input.personId,
      summary: "SSN eliminado",
    });
  });
  return getSensitiveIdentitySummary(actor, input.personId);
}

// Retorna el valor COMPLETO — solo debe llamarse desde una Server
// Action disparada explícitamente por el botón "Mostrar" (nunca en la
// carga inicial de la página, §17-§19 de la ficha). No cacheable: una
// Server Action de Next.js nunca se sirve desde caché de forma
// implícita.
export async function revealSsn(actor: AuthorizedUser, rawInput: unknown): Promise<string> {
  const input = parseOrThrow(personIdOnlySchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, ssnEncrypted: true },
  });
  if (!existing?.ssnEncrypted) throw new AppError("NOT_FOUND", "SSN no registrado.");

  let plaintext: string;
  try {
    plaintext = decryptPii(existing.ssnEncrypted);
  } catch {
    // Nunca se expone el detalle del error de descifrado (podría
    // filtrar información sobre el ciphertext/clave) — ver §20 de la
    // ficha.
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar el SSN.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "PersonSensitiveIdentity",
    entityId: existing.id,
    action: "SSN_REVEALED",
    contactPersonId: input.personId,
    summary: "SSN consultado para operación autorizada",
  });

  return formatSsnFull(plaintext);
}

// ---------------------------------------------------------------------------
// USCIS / A-Number
// ---------------------------------------------------------------------------

export async function setUscisNumber(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(setUscisNumberSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const normalized = normalizeIdentifier(input.uscisNumber);
  if (!normalized) throw new AppError("VALIDATION_ERROR", "uscisNumber: El USCIS/A-Number es obligatorio.");
  const uscisNumberLast4 = last4(normalized);
  const uscisNumberEncrypted = encryptPii(normalized);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, uscisNumberLast4: true },
  });
  const isUpdate = Boolean(existing?.uscisNumberLast4);

  await prisma.$transaction(async (tx) => {
    const row = await getOrCreateSensitiveIdentityRow(tx, input.personId);
    await tx.personSensitiveIdentity.update({
      where: { id: row.id },
      data: { uscisNumberEncrypted, uscisNumberLast4 },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonSensitiveIdentity",
      entityId: row.id,
      action: isUpdate ? "USCIS_UPDATE" : "USCIS_SET",
      contactPersonId: input.personId,
      summary: isUpdate ? "USCIS/A-Number actualizado" : "USCIS/A-Number registrado",
    });
  });
  return getSensitiveIdentitySummary(actor, input.personId);
}

export async function removeUscisNumber(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(personIdOnlySchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, uscisNumberLast4: true },
  });
  if (!existing?.uscisNumberLast4) {
    throw new AppError("VALIDATION_ERROR", "No hay USCIS/A-Number registrado para eliminar.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.personSensitiveIdentity.update({
      where: { id: existing.id },
      data: { uscisNumberEncrypted: null, uscisNumberLast4: null },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonSensitiveIdentity",
      entityId: existing.id,
      action: "USCIS_REMOVED",
      contactPersonId: input.personId,
      summary: "USCIS/A-Number eliminado",
    });
  });
  return getSensitiveIdentitySummary(actor, input.personId);
}

export async function revealUscisNumber(actor: AuthorizedUser, rawInput: unknown): Promise<string> {
  const input = parseOrThrow(personIdOnlySchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const existing = await prisma.personSensitiveIdentity.findUnique({
    where: { personId: input.personId },
    select: { id: true, uscisNumberEncrypted: true },
  });
  if (!existing?.uscisNumberEncrypted) throw new AppError("NOT_FOUND", "USCIS/A-Number no registrado.");

  let plaintext: string;
  try {
    plaintext = decryptPii(existing.uscisNumberEncrypted);
  } catch {
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar el USCIS/A-Number.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "PersonSensitiveIdentity",
    entityId: existing.id,
    action: "USCIS_REVEALED",
    contactPersonId: input.personId,
    summary: "USCIS/A-Number consultado para operación autorizada",
  });
  return plaintext;
}

// ---------------------------------------------------------------------------
// Documentos migratorios
// ---------------------------------------------------------------------------

async function loadImmigrationDocumentForAccessCheck(documentId: string) {
  const document = await prisma.personImmigrationDocument.findUnique({
    where: { id: documentId },
    select: { id: true, personId: true, person: { select: { assignedAgentId: true } } },
  });
  if (!document) throw new AppError("NOT_FOUND", "Documento migratorio no encontrado.");
  return document;
}

export async function createImmigrationDocument(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createImmigrationDocumentSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManageSensitiveIdentity(actor, person);

  const documentNumberEncrypted = input.documentNumber ? encryptPii(input.documentNumber) : null;
  const documentNumberLast4 = input.documentNumber ? last4(input.documentNumber) : null;

  return prisma.$transaction(async (tx) => {
    const created = await tx.personImmigrationDocument.create({
      data: {
        personId: input.personId,
        documentType: input.documentType,
        documentNumberEncrypted,
        documentNumberLast4,
        issuedDate: input.issuedDate ?? null,
        expirationDate: input.expirationDate ?? null,
      },
      select: { id: true },
    });
    // Nunca se guarda el número de documento — ni en changes ni en
    // summary (§4-§5, §26-§27 de la ficha).
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonImmigrationDocument",
      entityId: created.id,
      action: "IMMIGRATION_DOCUMENT_CREATE",
      contactPersonId: input.personId,
      summary: "Documento migratorio agregado",
    });
    return created;
  });
}

export async function updateImmigrationDocument(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(immigrationDocumentIdSchema, rawId);
  const input = parseOrThrow(updateImmigrationDocumentSchema, rawInput);
  const document = await loadImmigrationDocumentForAccessCheck(id);
  assertCanManageSensitiveIdentity(actor, document.person);

  const existing = await prisma.personImmigrationDocument.findUniqueOrThrow({
    where: { id },
    select: { documentType: true, issuedDate: true, expirationDate: true },
  });

  const data: Prisma.PersonImmigrationDocumentUpdateInput = {};
  if (input.documentType !== undefined) data.documentType = input.documentType;
  if (input.issuedDate !== undefined) data.issuedDate = input.issuedDate;
  if (input.expirationDate !== undefined) data.expirationDate = input.expirationDate;
  if (input.documentNumber !== undefined) {
    data.documentNumberEncrypted = encryptPii(input.documentNumber);
    data.documentNumberLast4 = last4(input.documentNumber);
  }

  // Diff SOLO sobre campos no sensibles — documentNumber nunca entra a
  // buildDiff (§27 de la ficha), aunque haya cambiado.
  const changes = buildDiff(existing, { ...input }, IMMIGRATION_DOCUMENT_AUDIT_FIELDS);

  await prisma.$transaction(async (tx) => {
    await tx.personImmigrationDocument.update({ where: { id }, data });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonImmigrationDocument",
      entityId: id,
      action: "IMMIGRATION_DOCUMENT_UPDATE",
      contactPersonId: document.personId,
      summary: "Documento migratorio actualizado",
      changes,
    });
  });
  return { personId: document.personId };
}

export async function deactivateImmigrationDocument(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(immigrationDocumentIdSchema, rawId);
  const document = await loadImmigrationDocumentForAccessCheck(id);
  assertCanManageSensitiveIdentity(actor, document.person);

  await prisma.$transaction(async (tx) => {
    await tx.personImmigrationDocument.update({ where: { id }, data: { isActive: false } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonImmigrationDocument",
      entityId: id,
      action: "IMMIGRATION_DOCUMENT_DEACTIVATE",
      contactPersonId: document.personId,
      summary: "Documento migratorio desactivado",
    });
  });
  return { personId: document.personId };
}

export async function revealImmigrationDocumentNumber(actor: AuthorizedUser, rawId: unknown): Promise<string> {
  const id = parseOrThrow(immigrationDocumentIdSchema, rawId);
  const document = await loadImmigrationDocumentForAccessCheck(id);
  assertCanManageSensitiveIdentity(actor, document.person);

  const existing = await prisma.personImmigrationDocument.findUniqueOrThrow({
    where: { id },
    select: { documentNumberEncrypted: true },
  });
  if (!existing.documentNumberEncrypted) throw new AppError("NOT_FOUND", "Este documento no tiene número registrado.");

  let plaintext: string;
  try {
    plaintext = decryptPii(existing.documentNumberEncrypted);
  } catch {
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar el número de documento.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "PersonImmigrationDocument",
    entityId: id,
    action: "IMMIGRATION_DOCUMENT_REVEALED",
    contactPersonId: document.personId,
    summary: "Número de documento migratorio consultado para operación autorizada",
  });
  return plaintext;
}
