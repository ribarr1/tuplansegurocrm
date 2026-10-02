import "server-only";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Secretos de LeadIntegrationCredential — Fase 026.
//
// El secreto real NUNCA se guarda: solo su hash SHA-256 (hashedSecret).
// `credentialKey` es un identificador PÚBLICO (no secreto, va en texto
// plano en el header Authorization) que permite ubicar la fila por
// índice único sin recorrer todos los hashes de la tabla — mismo
// propósito que un "key id" de Stripe/AWS. El secreto es aleatorio de
// 256 bits (crypto.randomBytes), nunca derivado de datos predecibles,
// así que un hash simple (sin salt por fila) es apropiado: a diferencia
// de una contraseña elegida por un humano, no hay diccionario de
// ataque viable contra un secreto de alta entropía generado aquí mismo.
// La comparación usa timingSafeEqual para no filtrar el hash por
// tiempo de respuesta.
// ---------------------------------------------------------------------------

const CREDENTIAL_KEY_PREFIX = "leadcred_";
const SECRET_BYTES = 32;

export function generateCredentialKey(): string {
  return `${CREDENTIAL_KEY_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

export function generateCredentialSecret(): string {
  return crypto.randomBytes(SECRET_BYTES).toString("base64url");
}

export function hashCredentialSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyCredentialSecret(secret: string, hashedSecret: string): boolean {
  const candidate = Buffer.from(hashCredentialSecret(secret), "hex");
  const expected = Buffer.from(hashedSecret, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Formato del header Authorization: "Bearer <credentialKey>.<secret>" —
// el prefijo del credentialKey nunca cambia, así que un valor sin "."
// o sin el separador se rechaza rápido sin tocar la base de datos.
export function parseBearerCredential(authorizationHeader: string | null): { credentialKey: string; secret: string } | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  if (!match) return null;
  const token = match[1].trim();
  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;
  return {
    credentialKey: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  };
}
