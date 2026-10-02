import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { LEAD_SOURCE_VALUES } from "@/schemas/lead.schema";
import {
  generateCredentialKey,
  generateCredentialSecret,
  hashCredentialSecret,
  parseBearerCredential,
  verifyCredentialSecret,
} from "@/lib/lead-credential-secret";
import { recordAuditEvent } from "@/services/audit.service";
import {
  encryptConnectorSecretsObject,
  decryptConnectorSecretsObject,
  type ConnectorSecrets,
} from "@/lib/lead-connector-crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Credenciales de integración de la Fábrica de leads — Fase 026.
//
// Administración: solo ADMIN. El secreto en texto plano se devuelve
// UNA SOLA VEZ, en la respuesta de createLeadCredential — nunca se
// puede recuperar después (solo se guarda su hash). Nunca se registra
// en logs ni en AuditEvent.metadata.
// ---------------------------------------------------------------------------

const createCredentialSchema = z.object({
  label: z.string().trim().min(1, "La etiqueta es requerida.").max(200),
  source: z.enum(LEAD_SOURCE_VALUES, "Selecciona una fuente válida.").refine((v) => v !== "MANUAL", {
    message: "MANUAL no es una fuente de integración — se usa solo para leads creados a mano.",
  }),
});

function assertAdmin(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede gestionar credenciales de integración.");
  }
}

export async function listLeadCredentials(actor: AuthorizedUser) {
  assertAdmin(actor);
  const credentials = await prisma.leadIntegrationCredential.findMany({
    select: {
      id: true,
      label: true,
      source: true,
      credentialKey: true,
      isActive: true,
      createdAt: true,
      revokedAt: true,
      connectorSecrets: true,
      customFieldMapping: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // `connectorSecrets` (cifrado) nunca sale de este servicio — se
  // reduce a un booleano para la UI ("¿ya está configurado?").
  // `customFieldMapping` SÍ sale tal cual — nunca es secreto (son
  // nombres de campo, no credenciales).
  return credentials.map(({ connectorSecrets, customFieldMapping, ...rest }) => ({
    ...rest,
    hasConnectorSecrets: connectorSecrets !== null,
    customFieldMapping: customFieldMapping as { residenceStateFieldKey?: string; productInterestFieldKey?: string } | null,
  }));
}

export async function createLeadCredential(actor: AuthorizedUser, rawInput: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(createCredentialSchema, rawInput);

  const credentialKey = generateCredentialKey();
  const secret = generateCredentialSecret();
  const hashedSecret = hashCredentialSecret(secret);

  const credential = await prisma.$transaction(async (tx) => {
    const created = await tx.leadIntegrationCredential.create({
      data: {
        label: input.label,
        source: input.source,
        credentialKey,
        hashedSecret,
        createdById: actor.id,
      },
      select: { id: true, label: true, source: true, credentialKey: true, isActive: true, createdAt: true },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadIntegrationCredential",
      entityId: created.id,
      action: "LEAD_CREDENTIAL_CREATE",
      summary: `Credencial de integración creada: ${created.label} (${created.source})`,
    });
    return created;
  });

  // El secreto en texto plano solo existe en esta respuesta — nunca se
  // vuelve a poder leer ni se guarda en ningún lado más que aquí.
  return { ...credential, secret, authorizationHeaderValue: `Bearer ${credentialKey}.${secret}` };
}

export async function revokeLeadCredential(actor: AuthorizedUser, rawId: unknown) {
  assertAdmin(actor);
  const id = z.uuid("Identificador de credencial inválido.").parse(rawId);

  const existing = await prisma.leadIntegrationCredential.findUnique({
    where: { id },
    select: { id: true, label: true, isActive: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  if (!existing.isActive) return existing;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.leadIntegrationCredential.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
      select: { id: true, label: true, isActive: true, revokedAt: true },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadIntegrationCredential",
      entityId: id,
      action: "LEAD_CREDENTIAL_REVOKE",
      summary: `Credencial de integración revocada: ${existing.label}`,
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Secretos del CONECTOR (Google/Meta) — distintos del secreto de
// `/api/leads/intake` (ver lead-connector-crypto.ts). Solo ADMIN los
// configura; nunca se devuelven en claro a ninguna ruta/Server Action,
// solo se leen internamente desde los webhooks/worker ya autenticados
// por su propio mecanismo (google_key / X-Hub-Signature-256).
// ---------------------------------------------------------------------------
const setGoogleConnectorSecretsSchema = z.object({
  verificationKey: z.string().trim().min(8, "La clave de verificación de Google es demasiado corta.").max(500),
});

const setMetaConnectorSecretsSchema = z.object({
  appSecret: z.string().trim().min(8, "El App Secret de Meta es demasiado corto.").max(500),
  pageAccessToken: z.string().trim().min(8, "El Page Access Token de Meta es demasiado corto.").max(2000),
  verifyToken: z.string().trim().min(8, "El verify token es demasiado corto.").max(500),
  pageId: z.string().trim().min(1, "El ID de página de Meta es requerido.").max(200),
});

async function assertCredentialForSource(credentialId: string, expectedSource: "GOOGLE" | "META") {
  const credential = await prisma.leadIntegrationCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, label: true, source: true },
  });
  if (!credential) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  if (credential.source !== expectedSource) {
    throw new AppError(
      "VALIDATION_ERROR",
      `source: Esta credencial es de fuente ${credential.source}, no ${expectedSource}.`
    );
  }
  return credential;
}

export async function setGoogleConnectorSecrets(actor: AuthorizedUser, credentialId: string, rawInput: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(setGoogleConnectorSecretsSchema, rawInput);
  const credential = await assertCredentialForSource(credentialId, "GOOGLE");

  const encrypted = encryptConnectorSecretsObject({ provider: "GOOGLE", verificationKey: input.verificationKey });
  await prisma.$transaction(async (tx) => {
    await tx.leadIntegrationCredential.update({ where: { id: credentialId }, data: { connectorSecrets: encrypted } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadIntegrationCredential",
      entityId: credentialId,
      action: "LEAD_CREDENTIAL_CONFIGURE_CONNECTOR",
      summary: `Configuración del conector Google guardada: ${credential.label}`,
    });
  });
}

export async function setMetaConnectorSecrets(actor: AuthorizedUser, credentialId: string, rawInput: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(setMetaConnectorSecretsSchema, rawInput);
  const credential = await assertCredentialForSource(credentialId, "META");

  const encrypted = encryptConnectorSecretsObject({
    provider: "META",
    appSecret: input.appSecret,
    pageAccessToken: input.pageAccessToken,
    verifyToken: input.verifyToken,
    pageId: input.pageId,
  });
  await prisma.$transaction(async (tx) => {
    await tx.leadIntegrationCredential.update({ where: { id: credentialId }, data: { connectorSecrets: encrypted } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadIntegrationCredential",
      entityId: credentialId,
      action: "LEAD_CREDENTIAL_CONFIGURE_CONNECTOR",
      summary: `Configuración del conector Meta guardada: ${credential.label}`,
    });
  });
}

// ---------------------------------------------------------------------------
// Mapeo de preguntas personalizadas (§6, Preparación para producción)
// — NUNCA cifrado (un nombre/column_id de campo no es un secreto),
// NUNCA mezclado con connectorSecrets. Configurable por ADMIN sin
// desplegar código cada vez que cambia un formulario (ver
// src/lib/lead-source-mapping.ts).
// ---------------------------------------------------------------------------
const setCustomFieldMappingSchema = z.object({
  residenceStateFieldKey: z.string().trim().max(200).optional(),
  productInterestFieldKey: z.string().trim().max(200).optional(),
});

export async function setCustomFieldMapping(actor: AuthorizedUser, credentialId: string, rawInput: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(setCustomFieldMappingSchema, rawInput);
  const credential = await prisma.leadIntegrationCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, label: true, source: true },
  });
  if (!credential) throw new AppError("NOT_FOUND", "Credencial no encontrada.");
  if (credential.source !== "GOOGLE" && credential.source !== "META") {
    throw new AppError("VALIDATION_ERROR", "source: El mapeo de preguntas personalizadas solo aplica a Google/Meta.");
  }

  // Ausente/"" en ambos campos = sin mapeo configurado (vuelve a
  // null) — nunca un objeto vacío ambiguo.
  const mapping =
    input.residenceStateFieldKey || input.productInterestFieldKey
      ? { residenceStateFieldKey: input.residenceStateFieldKey, productInterestFieldKey: input.productInterestFieldKey }
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.leadIntegrationCredential.update({
      where: { id: credentialId },
      data: { customFieldMapping: mapping ?? Prisma.JsonNull },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadIntegrationCredential",
      entityId: credentialId,
      action: "LEAD_CREDENTIAL_SET_FIELD_MAPPING",
      summary: `Mapeo de preguntas personalizadas actualizado: ${credential.label}`,
      changes: { customFieldMapping: { before: undefined, after: mapping } },
    });
  });
}

// Uso interno exclusivo de rutas de webhook ya autenticadas por su
// propio mecanismo y del worker — nunca se expone a una Server Action
// ni a una respuesta de API hacia el navegador.
export async function getDecryptedConnectorSecrets(credentialId: string): Promise<ConnectorSecrets | null> {
  const credential = await prisma.leadIntegrationCredential.findUnique({
    where: { id: credentialId },
    select: { connectorSecrets: true },
  });
  if (!credential?.connectorSecrets) return null;
  return decryptConnectorSecretsObject(credential.connectorSecrets);
}

export async function findActiveCredentialBySource(source: "GOOGLE" | "META") {
  return prisma.leadIntegrationCredential.findMany({
    where: { source, isActive: true },
    select: { id: true, connectorSecrets: true },
  });
}

// ---------------------------------------------------------------------------
// Verificación usada por la ruta de recepción (machine-to-machine, sin
// sesión de usuario) — nunca expone cuál de los dos factores (key vs.
// secret) falló, ni filtra el hash almacenado.
// ---------------------------------------------------------------------------
export async function authenticateLeadCredential(authorizationHeader: string | null) {
  const parsed = parseBearerCredential(authorizationHeader);
  if (!parsed) {
    throw new AppError("UNAUTHORIZED", "Credencial no proporcionada o con formato inválido.");
  }

  const credential = await prisma.leadIntegrationCredential.findUnique({
    where: { credentialKey: parsed.credentialKey },
    select: { id: true, source: true, isActive: true, hashedSecret: true },
  });
  if (!credential || !credential.isActive || !verifyCredentialSecret(parsed.secret, credential.hashedSecret)) {
    throw new AppError("UNAUTHORIZED", "Credencial inválida o revocada.");
  }

  return { id: credential.id, source: credential.source };
}
