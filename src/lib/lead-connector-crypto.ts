import "server-only";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Fase 026 — Preparación para producción. Cifrado dedicado para los
// secretos propios de cada CONECTOR (google_key de Google, app
// secret/page access token/verify token de Meta) — guardados en
// `LeadIntegrationCredential.connectorSecrets`. Mismo patrón exacto
// que financial-crypto.ts: subclave derivada vía HKDF-SHA256 de la
// MISMA llave maestra (PII_ENCRYPTION_KEY, nunca una nueva variable de
// entorno que administrar) con un dominio ("info") PROPIO, más AAD de
// ese mismo dominio en AES-256-GCM — un blob de este dominio nunca se
// puede descifrar "por accidente" con otra subclave, ni viceversa.
//
// Nunca es el mismo secreto que autentica `/api/leads/intake`
// (`LeadIntegrationCredential.hashedSecret`, un HASH de un solo
// sentido) — esto es cifrado REVERSIBLE porque el worker necesita leer
// estos valores en claro para llamar a la API de Meta o validar la
// clave de Google.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "leadconn-v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const HKDF_INFO = Buffer.from("tuplanseguro-lead-connector-v1", "utf8");
const AAD = Buffer.from("tuplanseguro-lead-connector-v1", "utf8");

let cachedSubkey: Buffer | undefined;

function readMasterKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "PII_ENCRYPTION_KEY no está configurado. Genera uno con " +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` y agrégalo a .env.'
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("PII_ENCRYPTION_KEY inválido: no es base64 válido.");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PII_ENCRYPTION_KEY inválido: debe decodificar a ${KEY_BYTES} bytes (AES-256), se obtuvieron ${key.length}.`
    );
  }
  return key;
}

function deriveConnectorSubkey(): Buffer {
  if (!cachedSubkey) {
    const master = readMasterKey();
    const derived = crypto.hkdfSync("sha256", master, Buffer.alloc(0), HKDF_INFO, KEY_BYTES);
    cachedSubkey = Buffer.from(derived);
  }
  return cachedSubkey;
}

export function _resetLeadConnectorCryptoKeyCacheForTests(): void {
  cachedSubkey = undefined;
}

export function encryptConnectorSecrets(plaintextJson: string): string {
  const key = deriveConnectorSubkey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintextJson, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export function decryptConnectorSecrets(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("No se pudo descifrar el valor: formato no reconocido.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const key = deriveConnectorSubkey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar el valor: los datos pueden estar corruptos o la clave no coincide.");
  }
}

// ---------------------------------------------------------------------------
// Forma de cada tipo de conector — nunca se guarda en claro, nunca se
// expone en una respuesta de API/Server Action completa (solo
// booleanos "¿está configurado?" para la UI, ver lead-connectors.service.ts).
// ---------------------------------------------------------------------------
export type GoogleConnectorSecrets = {
  provider: "GOOGLE";
  verificationKey: string;
};

export type MetaConnectorSecrets = {
  provider: "META";
  appSecret: string;
  pageAccessToken: string;
  verifyToken: string;
  pageId: string;
};

export type ConnectorSecrets = GoogleConnectorSecrets | MetaConnectorSecrets;

export function encryptConnectorSecretsObject(secrets: ConnectorSecrets): string {
  return encryptConnectorSecrets(JSON.stringify(secrets));
}

export function decryptConnectorSecretsObject(stored: string): ConnectorSecrets {
  return JSON.parse(decryptConnectorSecrets(stored)) as ConnectorSecrets;
}
