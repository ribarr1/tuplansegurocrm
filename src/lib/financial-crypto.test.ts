import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  encryptFinancial,
  decryptFinancial,
  last4,
  _resetFinancialCryptoKeyCacheForTests,
} from "@/lib/financial-crypto";
import { encryptPii, _resetPiiEncryptionKeyCacheForTests } from "@/lib/pii-crypto";

const ORIGINAL_KEY = process.env.PII_ENCRYPTION_KEY;

afterEach(() => {
  process.env.PII_ENCRYPTION_KEY = ORIGINAL_KEY;
  _resetFinancialCryptoKeyCacheForTests();
  _resetPiiEncryptionKeyCacheForTests();
});

describe("financial-crypto (AMPLIACIÓN PREPRODUCCIÓN — métodos de pago)", () => {
  it("encrypt/decrypt roundtrip returns the original plaintext", () => {
    const ciphertext = encryptFinancial("4111111111111111");
    expect(decryptFinancial(ciphertext)).toBe("4111111111111111");
  });

  it("nunca guarda el plaintext dentro del ciphertext resultante", () => {
    const ciphertext = encryptFinancial("4111111111111111");
    expect(ciphertext).not.toContain("4111111111111111");
  });

  it("produce un formato versionado fin-v1:<iv>:<authTag>:<ciphertext> — DISTINTO del de pii-crypto (v1:...)", () => {
    const ciphertext = encryptFinancial("hello");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("fin-v1");
  });

  it("dos cifrados del mismo valor producen ciphertexts distintos (IV aleatorio)", () => {
    const a = encryptFinancial("4111111111111111");
    const b = encryptFinancial("4111111111111111");
    expect(a).not.toBe(b);
  });

  it("es cifrado autenticado: GCM detecta manipulación del ciphertext", () => {
    const ciphertext = encryptFinancial("4111111111111111");
    const parts = ciphertext.split(":");
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      Buffer.from(parts[3], "base64").reverse().toString("base64"),
    ].join(":");
    expect(() => decryptFinancial(tampered)).toThrow();
  });

  it("un ciphertext manipulado se rechaza de forma segura (error genérico, nunca el valor parcial)", () => {
    const ciphertext = encryptFinancial("4111111111111111");
    const tampered = ciphertext.slice(0, -4) + "XXXX";
    let caught: unknown;
    try {
      decryptFinancial(tampered);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("4111111111111111");
  });

  it("rechaza un formato no reconocido sin lanzar información sensible", () => {
    expect(() => decryptFinancial("not-a-valid-format")).toThrow(/formato no reconocido/);
  });

  it("rechaza el formato de pii-crypto (v1:...) — nunca lo interpreta como propio", () => {
    process.env.PII_ENCRYPTION_KEY = ORIGINAL_KEY;
    const piiCiphertext = encryptPii("123456789");
    expect(() => decryptFinancial(piiCiphertext)).toThrow(/formato no reconocido/);
  });

  it("SEPARACIÓN DE CONTEXTO: aunque alguien construyera manualmente un valor con el prefijo fin-v1 usando la subclave equivocada (AAD distinto), la verificación de integridad lo rechaza", () => {
    // Simula el escenario que la separación de contexto previene: un
    // ciphertext cifrado bajo un dominio/AAD distinto nunca debe
    // aceptarse como si fuera un dato financiero legítimo, aunque
    // comparta la misma llave maestra y el mismo algoritmo.
    const master = Buffer.from(ORIGINAL_KEY!, "base64");
    const wrongInfo = Buffer.from("otro-dominio-cualquiera", "utf8");
    const subkey = Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), wrongInfo, 32));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", subkey, iv);
    cipher.setAAD(wrongInfo);
    const ciphertext = Buffer.concat([cipher.update("4111111111111111", "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const forged = [
      "fin-v1",
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
    expect(() => decryptFinancial(forged)).toThrow();
  });

  it("lanza un error claro si PII_ENCRYPTION_KEY no está configurado", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    _resetFinancialCryptoKeyCacheForTests();
    expect(() => encryptFinancial("4111111111111111")).toThrow(/PII_ENCRYPTION_KEY no está configurado/);
  });

  it("lanza un error claro si PII_ENCRYPTION_KEY no decodifica a 32 bytes", () => {
    process.env.PII_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    _resetFinancialCryptoKeyCacheForTests();
    expect(() => encryptFinancial("4111111111111111")).toThrow(/32 bytes/);
  });

  describe("last4", () => {
    it("extrae los últimos 4 dígitos de un número de tarjeta", () => {
      expect(last4("4111 1111 1111 1234")).toBe("1234");
    });

    it("extrae los últimos 4 dígitos de un número de cuenta más corto", () => {
      expect(last4("123456789")).toBe("6789");
    });

    it("nunca lanza con un valor más corto que 4 dígitos", () => {
      expect(last4("12")).toBe("12");
    });
  });
});
