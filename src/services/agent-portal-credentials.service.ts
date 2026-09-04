import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  userIdSchema,
  agentPortalCredentialIdSchema,
  createAgentPortalCredentialSchema,
  updateAgentPortalCredentialSchema,
  credentialFieldSchema,
} from "@/schemas/credential-vault.schema";
import { encryptPii, decryptPii } from "@/lib/pii-crypto";
import { recordAuditEvent } from "@/services/audit.service";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Vault de credenciales de PORTALES DEL AGENTE — Fase 025 (Parte J).
//
// Reutiliza EXACTAMENTE el cifrado de sensitive-identity.service.ts
// (encryptPii/decryptPii, AES-256-GCM, Fase 021) — nunca una segunda
// implementación de cifrado. Reversible (nunca hasheado): el objetivo
// es poder iniciar sesión en el portal real, a diferencia de una
// contraseña de la propia app.
//
// Autorización — MÁS estricta que ClientPortalCredential porque esto
// es la identidad del AGENTE frente al carrier, no un dato operativo
// de un cliente compartido: ADMIN administra/revela cualquiera; AGENT
// administra/revela ÚNICAMENTE las suyas propias; ASSISTANT sin
// ningún acceso (ni siquiera lectura enmascarada) — mismo criterio que
// canAccessSensitiveIdentity en sensitive-identity.service.ts.
//
// CRÍTICO: username/password NUNCA se seleccionan en texto plano
// salvo dentro de reveal*() — el listado/detalle normal solo expone
// una máscara fija (nunca deriva "last4" de una contraseña, a
// diferencia de SSN: mostrar los últimos caracteres de una contraseña
// reduce su espacio de búsqueda de forma innecesaria).
// ---------------------------------------------------------------------------

const MASKED_USERNAME = "••••••••";
const MASKED_PASSWORD = "••••••••••••";

const credentialListSelect = {
  id: true,
  userId: true,
  carrierId: true,
  portalName: true,
  portalUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  carrier: { select: { id: true, name: true } },
} satisfies Prisma.AgentPortalCredentialSelect;

function assertCanAccess(actor: AuthorizedUser, userId: string) {
  if (actor.role === "ADMIN") return;
  if (actor.role === "AGENT" && actor.id === userId) return;
  throw new AppError("FORBIDDEN", "No tienes acceso a estas credenciales.");
}

export async function listAgentPortalCredentials(actor: AuthorizedUser, rawUserId: unknown) {
  const userId = parseOrThrow(userIdSchema, rawUserId);
  assertCanAccess(actor, userId);
  const rows = await prisma.agentPortalCredential.findMany({
    where: { userId },
    select: credentialListSelect,
    orderBy: { portalName: "asc" },
  });
  return rows.map((r) => ({ ...r, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD }));
}

export async function createAgentPortalCredential(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createAgentPortalCredentialSchema, rawInput);
  assertCanAccess(actor, input.userId);

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  if (input.carrierId) {
    const carrier = await prisma.carrier.findUnique({ where: { id: input.carrierId }, select: { id: true } });
    if (!carrier) throw new AppError("NOT_FOUND", "Compañía no encontrada.");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.agentPortalCredential.create({
      data: {
        userId: input.userId,
        carrierId: input.carrierId,
        portalName: input.portalName,
        portalUrl: input.portalUrl,
        usernameEncrypted: encryptPii(input.username),
        passwordEncrypted: encryptPii(input.password),
        notesEncrypted: input.notes ? encryptPii(input.notes) : null,
      },
      select: credentialListSelect,
    });
    // Nunca se guarda usuario/password/notas en el audit log — solo el
    // hecho de que se creó una credencial y para qué portal.
    await recordAuditEvent(tx, {
      actor,
      entityType: "AgentPortalCredential",
      entityId: created.id,
      action: "CREDENTIAL_CREATED",
      summary: `Credencial de portal creada: ${input.portalName}`,
    });
    return { ...created, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

async function loadForAccessCheck(id: string) {
  const existing = await prisma.agentPortalCredential.findUnique({
    where: { id },
    select: { id: true, userId: true, portalName: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  return existing;
}

export async function updateAgentPortalCredential(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(agentPortalCredentialIdSchema, rawId);
  const input = parseOrThrow(updateAgentPortalCredentialSchema, rawInput);
  const existing = await loadForAccessCheck(id);
  assertCanAccess(actor, existing.userId);

  const data: Prisma.AgentPortalCredentialUpdateInput = {};
  if (input.carrierId !== undefined) {
    data.carrier = input.carrierId ? { connect: { id: input.carrierId } } : { disconnect: true };
  }
  if (input.portalName !== undefined) data.portalName = input.portalName;
  if (input.portalUrl !== undefined) data.portalUrl = input.portalUrl;
  if (input.username !== undefined) data.usernameEncrypted = encryptPii(input.username);
  if (input.password !== undefined) data.passwordEncrypted = encryptPii(input.password);
  if (input.notes !== undefined) data.notesEncrypted = input.notes ? encryptPii(input.notes) : null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.agentPortalCredential.update({ where: { id }, data, select: credentialListSelect });
    // changes NUNCA incluye username/password/notas — solo el hecho
    // semántico de "se actualizó", nunca antes/después del secreto.
    await recordAuditEvent(tx, {
      actor,
      entityType: "AgentPortalCredential",
      entityId: id,
      action: "CREDENTIAL_UPDATED",
      summary: `Credencial de portal actualizada: ${existing.portalName}`,
    });
    return { ...updated, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

// Preferido sobre hard delete (ver docs/DECISIONS.md, regla general de
// borrado del proyecto) — una credencial desactivada deja de listarse
// como utilizable pero conserva su historial de auditoría.
export async function deactivateAgentPortalCredential(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(agentPortalCredentialIdSchema, rawId);
  const existing = await loadForAccessCheck(id);
  assertCanAccess(actor, existing.userId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.agentPortalCredential.update({
      where: { id },
      data: { isActive: false },
      select: credentialListSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "AgentPortalCredential",
      entityId: id,
      action: "CREDENTIAL_DEACTIVATED",
      summary: `Credencial de portal desactivada: ${existing.portalName}`,
    });
    return { ...updated, usernameMasked: MASKED_USERNAME, passwordMasked: MASKED_PASSWORD };
  });
}

// Retorna el valor COMPLETO — solo debe llamarse desde una Server
// Action disparada explícitamente por el botón "Revelar" (nunca en la
// carga inicial de la página, mismo principio que revealSsn).
export async function revealAgentPortalCredentialField(
  actor: AuthorizedUser,
  rawId: unknown,
  rawField: unknown
): Promise<string> {
  const id = parseOrThrow(agentPortalCredentialIdSchema, rawId);
  const field = parseOrThrow(credentialFieldSchema, rawField);
  const existing = await prisma.agentPortalCredential.findUnique({
    where: { id },
    select: { id: true, userId: true, usernameEncrypted: true, passwordEncrypted: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  assertCanAccess(actor, existing.userId);

  const ciphertext = field === "username" ? existing.usernameEncrypted : existing.passwordEncrypted;
  let plaintext: string;
  try {
    plaintext = decryptPii(ciphertext);
  } catch {
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar la credencial.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "AgentPortalCredential",
    entityId: id,
    action: field === "username" ? "CREDENTIAL_USERNAME_REVEALED" : "CREDENTIAL_PASSWORD_REVEALED",
    summary: `${field === "username" ? "Usuario" : "Contraseña"} de portal de agente revelado`,
  });
  return plaintext;
}

// El valor YA se reveló antes (el cliente lo tiene en memoria) — este
// endpoint solo registra el hecho de que se copió, nunca vuelve a
// descifrar ni retorna nada.
export async function recordAgentPortalCredentialCopy(
  actor: AuthorizedUser,
  rawId: unknown,
  rawField: unknown
): Promise<void> {
  const id = parseOrThrow(agentPortalCredentialIdSchema, rawId);
  const field = parseOrThrow(credentialFieldSchema, rawField);
  const existing = await loadForAccessCheck(id);
  assertCanAccess(actor, existing.userId);

  await recordAuditEvent(prisma, {
    actor,
    entityType: "AgentPortalCredential",
    entityId: id,
    action: field === "username" ? "CREDENTIAL_USERNAME_COPIED" : "CREDENTIAL_PASSWORD_COPIED",
    summary: `${field === "username" ? "Usuario" : "Contraseña"} de portal de agente copiado`,
  });
}
