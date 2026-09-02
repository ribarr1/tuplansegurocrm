import { describe, it, expect, afterEach } from "vitest";
import { encryptPii, decryptPii, _resetPiiEncryptionKeyCacheForTests } from "@/lib/pii-crypto";

const ORIGINAL_KEY = process.env.PII_ENCRYPTION_KEY;

afterEach(() => {
  process.env.PII_ENCRYPTION_KEY = ORIGINAL_KEY;
  _resetPiiEncryptionKeyCacheForTests();
});

describe("pii-crypto", () => {
  it("E) encrypt/decrypt roundtrip returns the original plaintext", () => {
    const ciphertext = encryptPii("123456789");
    expect(decryptPii(ciphertext)).toBe("123456789");
  });

  it("nunca guarda el plaintext dentro del ciphertext resultante", () => {
    const ciphertext = encryptPii("123456789");
    expect(ciphertext).not.toContain("123456789");
  });

  it("produce un formato versionado v1:<iv>:<authTag>:<ciphertext>", () => {
    const ciphertext = encryptPii("hello");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("dos cifrados del mismo valor producen ciphertexts distintos (IV aleatorio)", () => {
    const a = encryptPii("123456789");
    const b = encryptPii("123456789");
    expect(a).not.toBe(b);
  });

  it("F) es cifrado autenticado: GCM detecta manipulación del ciphertext", () => {
    const ciphertext = encryptPii("123456789");
    const parts = ciphertext.split(":");
    // Corrompe un byte del ciphertext (última parte) sin tocar el authTag.
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      Buffer.from(parts[3], "base64").reverse().toString("base64"),
    ].join(":");
    expect(() => decryptPii(tampered)).toThrow();
  });

  it("G) un ciphertext manipulado se rechaza de forma segura (error genérico, nunca texto parcial)", () => {
    const ciphertext = encryptPii("123456789");
    const tampered = ciphertext.slice(0, -4) + "XXXX";
    let caught: unknown;
    try {
      decryptPii(tampered);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("123456789");
  });

  it("rechaza un formato no reconocido sin lanzar información sensible", () => {
    expect(() => decryptPii("not-a-valid-format")).toThrow(/formato no reconocido/);
  });

  it("lanza un error claro si PII_ENCRYPTION_KEY no está configurado", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    _resetPiiEncryptionKeyCacheForTests();
    expect(() => encryptPii("123456789")).toThrow(/PII_ENCRYPTION_KEY no está configurado/);
  });

  it("lanza un error claro si PII_ENCRYPTION_KEY no decodifica a 32 bytes", () => {
    process.env.PII_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    _resetPiiEncryptionKeyCacheForTests();
    expect(() => encryptPii("123456789")).toThrow(/32 bytes/);
  });
});
