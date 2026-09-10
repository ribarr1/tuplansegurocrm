import "server-only";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — cifrado dedicado para datos financieros
// (número de tarjeta, routing number, número de cuenta, comentario de
// método de pago). Nunca reutiliza src/lib/pii-crypto.ts directamente:
// ese módulo cifra SSN/USCIS/credenciales de portal con la MISMA llave
// sin ninguna separación de contexto (confirmado por inspección — no
// usa AAD ni una subclave derivada), así que el ciphertext de un dato
// financiero y el de un SSN serían indistinguibles para el algoritmo —
// una fuga o bug que confundiera columnas podría "descifrar
// exitosamente" datos del contexto equivocado. Aquí se deriva una
// SUBCLAVE distinta vía HKDF-SHA256 (construcción estándar de Node,
// RFC 5869 — nunca un cifrado inventado) a partir de la MISMA llave
// maestra (PII_ENCRYPTION_KEY, fuera de PostgreSQL y de Git) con un
// "info" fijo de dominio ("tuplanseguro-financial-v1"), y ADEMÁS pasa
// ese mismo contexto como AAD (Additional Authenticated Data) de
// AES-256-GCM — un ciphertext financiero movido a otra columna o
// descifrado con la función equivocada falla la verificación de
// integridad en vez de "funcionar por accidente".
//
// Formato de rotación: version prefix ("fin-v1:...") — igual criterio
// que pii-crypto-core.ts. La ROTACIÓN real (re-cifrar filas existentes
// bajo una llave nueva) NO está implementada todavía — documentado
// como riesgo pendiente antes de producción (ver docs/SECURITY.md).
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "fin-v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const HKDF_INFO = Buffer.from("tuplanseguro-financial-v1", "utf8");
const AAD = Buffer.from("tuplanseguro-financial-v1", "utf8");

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

// Subclave derivada — nunca la llave maestra directamente. HKDF-SHA256
// con salt vacío (aceptable per RFC 5869 cuando la entrada ya es
// uniformemente aleatoria, como es el caso de PII_ENCRYPTION_KEY) e
// "info" fijo que ata la subclave a este dominio específico.
function deriveFinancialSubkey(): Buffer {
  if (!cachedSubkey) {
    const master = readMasterKey();
    const derived = crypto.hkdfSync("sha256", master, Buffer.alloc(0), HKDF_INFO, KEY_BYTES);
    cachedSubkey = Buffer.from(derived);
  }
  return cachedSubkey;
}

export function _resetFinancialCryptoKeyCacheForTests(): void {
  cachedSubkey = undefined;
}

export function encryptFinancial(plaintext: string): string {
  const key = deriveFinancialSubkey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export function decryptFinancial(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("No se pudo descifrar el valor: formato no reconocido.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const key = deriveFinancialSubkey();
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

// Últimos 4 caracteres visibles, sin espacios — para mostrar sin
// descifrar nada. Nunca se calcula al vuelo desde el ciphertext (eso
// requeriría descifrar); se guarda una vez al capturar el valor.
export function last4(fullValue: string): string {
  const digitsOnly = fullValue.replace(/\D/g, "");
  return digitsOnly.slice(-4).padStart(Math.min(4, digitsOnly.length), "0");
}
