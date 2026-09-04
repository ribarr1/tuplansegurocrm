import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import {
  personIdSchema,
  clientPortalCredentialIdSchema,
  createClientPortalCredentialSchema,
  updateClientPortalCredentialSchema,
  credentialFieldSchema,
} from "@/schemas/credential-vault.schema";
import { encryptPii, decryptPii } from "@/lib/pii-crypto";
import { recordAuditEvent } from "@/services/audit.service";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Vault de credenciales de PORTALES DEL CLIENTE — Fase 025 (Parte J).
//
// Reutiliza EXACTAMENTE el mismo cifrado que AgentPortalCredential
// (encryptPii/decryptPii) — nunca una segunda implementación.
//
// carrierId es OPCIONAL a propósito: un exchange estatal como "Get
// Covered Illinois" o "Georgia Access" no es un carrier real y nunca
// debe fabricarse como uno solo para poder guardar una credencial —
// portalType (STATE_EXCHANGE, etc.) distingue el caso.
//
// Autorización — DOS niveles, igual criterio que
// sensitive-identity.service.ts pero con un matiz: ASSISTANT SÍ
// administra (crear/editar/desactivar), es la superficie operativa
// del día a día — únicamente "Revelar"/"Copiar" el secreto está
// vedado para ASSISTANT por defecto (§J de la ficha).
//   - Gestionar (ver enmascarado/crear/editar/desactivar): ADMIN
//     siempre; AGENT solo con acceso operativo al contacto
//     (canEditPerson); ASSISTANT siempre (igual que Primas/Pagos).
//   - Revelar/Copiar el secreto: ADMIN siempre; AGENT solo con acceso
//     operativo; ASSISTANT NUNCA.
// ---------------------------------------------------------------------------

const MASKED_USERNAME = "••••••••";
const MASKED_PASSWORD = "••••••••••••";

const credentialListSelect = {
  id: true,
  personId: true,
  carrierId: true,
  policyId: true,
  portalType: true,
  portalName: true,
  portalUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  carrier: { select: { id: true, name: true } },
} satisfies Prisma.ClientPortalCredentialSelect;

async function loadPersonForAccessCheck(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

function assertCanManage(actor: AuthorizedUser, person: { assignedAgentId: string | null }) {
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }
}

// El gate de reveal/copy es MÁS estricto que canEditPerson: ASSISTANT
// siempre false aquí, aunque canEditPerson lo trate como sin
// restricción para el resto del contacto (mismo patrón que
// canAccessSensitiveIdentity, sensitive-identity.service.ts).
export function canRevealClientPortalCredential(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "AGENT") {
    return person.assignedAgentId === null || person.assignedAgentId === actor.id;
  }
  return false;
}

function assertCanReveal(actor: AuthorizedUser, person: { assignedAgentId: string | null }) {
  if (!canRevealClientPortalCredential(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes autorización para revelar esta credencial.");
  }
}

export async function listClientPortalCredentials(actor: AuthorizedUser, rawPersonId: unknown) {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await loadPersonForAccessCheck(personId);
  assertCanManage(actor, person);

  const rows = await prisma.clientPortalCredential.findMany({
    where: { personId },
    select: credentialListSelect,
    orderBy: { portalName: "asc" },
  });
  return {
    canReveal: canRevealClientPortalCredential(actor, person),
    items: rows.map((r) => ({ ...r, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD })),
  };
}

export async function createClientPortalCredential(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createClientPortalCredentialSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanManage(actor, person);

  if (input.carrierId) {
    const carrier = await prisma.carrier.findUnique({ where: { id: input.carrierId }, select: { id: true } });
    if (!carrier) throw new AppError("NOT_FOUND", "Compañía no encontrada.");
  }
  if (input.policyId) {
    const policy = await prisma.policy.findUnique({
      where: { id: input.policyId },
      select: { id: true, holderId: true },
    });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.clientPortalCredential.create({
      data: {
        personId: input.personId,
        carrierId: input.carrierId,
        policyId: input.policyId,
        portalType: input.portalType,
        portalName: input.portalName,
        portalUrl: input.portalUrl,
        usernameEncrypted: encryptPii(input.username),
        passwordEncrypted: encryptPii(input.password),
      },
      select: credentialListSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "ClientPortalCredential",
      entityId: created.id,
      action: "CREDENTIAL_CREATED",
      contactPersonId: input.personId,
      summary: `Credencial de portal de cliente creada: ${input.portalName}`,
    });
    return { ...created, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

async function loadCredentialForAccessCheck(id: string) {
  const existing = await prisma.clientPortalCredential.findUnique({
    where: { id },
    select: {
      id: true,
      portalName: true,
      person: { select: { id: true, assignedAgentId: true } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  return existing;
}

export async function updateClientPortalCredential(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(clientPortalCredentialIdSchema, rawId);
  const input = parseOrThrow(updateClientPortalCredentialSchema, rawInput);
  const existing = await loadCredentialForAccessCheck(id);
  assertCanManage(actor, existing.person);

  const data: Prisma.ClientPortalCredentialUpdateInput = {};
  if (input.portalType !== undefined) data.portalType = input.portalType;
  if (input.portalName !== undefined) data.portalName = input.portalName;
  if (input.portalUrl !== undefined) data.portalUrl = input.portalUrl;
  if (input.username !== undefined) data.usernameEncrypted = encryptPii(input.username);
  if (input.password !== undefined) data.passwordEncrypted = encryptPii(input.password);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.clientPortalCredential.update({ where: { id }, data, select: credentialListSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "ClientPortalCredential",
      entityId: id,
      action: "CREDENTIAL_UPDATED",
      contactPersonId: existing.person.id,
      summary: `Credencial de portal de cliente actualizada: ${existing.portalName}`,
    });
    return { ...updated, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

export async function deactivateClientPortalCredential(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(clientPortalCredentialIdSchema, rawId);
  const existing = await loadCredentialForAccessCheck(id);
  assertCanManage(actor, existing.person);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.clientPortalCredential.update({
      where: { id },
      data: { isActive: false },
      select: credentialListSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "ClientPortalCredential",
      entityId: id,
      action: "CREDENTIAL_DEACTIVATED",
      contactPersonId: existing.person.id,
      summary: `Credencial de portal de cliente desactivada: ${existing.portalName}`,
    });
    return { ...updated, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

export async function revealClientPortalCredentialField(
  actor: AuthorizedUser,
  rawId: unknown,
  rawField: unknown
): Promise<string> {
  const id = parseOrThrow(clientPortalCredentialIdSchema, rawId);
  const field = parseOrThrow(credentialFieldSchema, rawField);
  const existing = await prisma.clientPortalCredential.findUnique({
    where: { id },
    select: {
      id: true,
      usernameEncrypted: true,
      passwordEncrypted: true,
      person: { select: { id: true, assignedAgentId: true } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  assertCanReveal(actor, existing.person);

  const ciphertext = field === "username" ? existing.usernameEncrypted : existing.passwordEncrypted;
  let plaintext: string;
  try {
    plaintext = decryptPii(ciphertext);
  } catch {
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar la credencial.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "ClientPortalCredential",
    entityId: id,
    action: field === "username" ? "CREDENTIAL_USERNAME_REVEALED" : "CREDENTIAL_PASSWORD_REVEALED",
    contactPersonId: existing.person.id,
    summary: `${field === "username" ? "Usuario" : "Contraseña"} de portal de cliente revelado`,
  });
  return plaintext;
}

export async function recordClientPortalCredentialCopy(
  actor: AuthorizedUser,
  rawId: unknown,
  rawField: unknown
): Promise<void> {
  const id = parseOrThrow(clientPortalCredentialIdSchema, rawId);
  const field = parseOrThrow(credentialFieldSchema, rawField);
  const existing = await loadCredentialForAccessCheck(id);
  assertCanReveal(actor, existing.person);

  await recordAuditEvent(prisma, {
    actor,
    entityType: "ClientPortalCredential",
    entityId: id,
    action: field === "username" ? "CREDENTIAL_USERNAME_COPIED" : "CREDENTIAL_PASSWORD_COPIED",
    contactPersonId: existing.person.id,
    summary: `${field === "username" ? "Usuario" : "Contraseña"} de portal de cliente copiado`,
  });
}
