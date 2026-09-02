import "server-only";
import crypto from "node:crypto";

// Cifrado autenticado recuperable para PII altamente sensible (SSN,
// USCIS/A-Number, números de documento migratorio) — Fase 021. NUNCA
// hash irreversible: el negocio necesita poder mostrar el valor
// completo bajo demanda a un usuario autorizado durante operaciones de
// Marketplace (ver docs/SENSITIVE_PII.md).
//
// AES-256-GCM (autenticado: cualquier manipulación del ciphertext hace
// fallar el descifrado en vez de devolver basura silenciosamente).
// Formato versionado ("v1:<iv>:<authTag>:<ciphertext>", todo en
// base64) para poder migrar de algoritmo/clave en el futuro sin tener
// que adivinar el formato de filas viejas — ver docs/DECISIONS.md.
//
// La clave NUNCA vive en la base de datos, el repo, NEXT_PUBLIC_*, logs
// ni AuditEvent — solo en PII_ENCRYPTION_KEY (.env local / secret de
// producción). Sin esa clave, los valores cifrados NO son recuperables
// (ver docs/SECURITY.md, "Gestión de la clave de cifrado").

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "v1";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // recomendado para GCM

let cachedKey: Buffer | undefined;

function readEncryptionKey(): Buffer {
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

function getEncryptionKey(): Buffer {
  if (!cachedKey) cachedKey = readEncryptionKey();
  return cachedKey;
}

// Solo para tests: fuerza a releer PII_ENCRYPTION_KEY de process.env en
// la siguiente llamada, en vez de reutilizar la clave cacheada — mismo
// patrón que _resetAppTimeZoneCacheForTests en business-time.ts.
export function _resetPiiEncryptionKeyCacheForTests(): void {
  cachedKey = undefined;
}

// Cifra un string en claro. Nunca loggea el plaintext ni el resultado.
export function encryptPii(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

// Descifra un valor producido por encryptPii. Lanza un Error genérico
// (nunca incluye el ciphertext ni la clave) si el formato es inválido
// o si la autenticación falla (ciphertext manipulado/corrupto) — GCM
// hace esto de forma segura por diseño, nunca devuelve texto parcial.
export function decryptPii(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("No se pudo descifrar el valor: formato no reconocido.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar el valor: los datos pueden estar corruptos o la clave no coincide.");
  }
}
