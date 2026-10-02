import { describe, it, expect } from "vitest";
import {
  encryptConnectorSecretsObject,
  decryptConnectorSecretsObject,
  encryptConnectorSecrets,
  decryptConnectorSecrets,
  _resetLeadConnectorCryptoKeyCacheForTests,
} from "./lead-connector-crypto";

describe("lead-connector-crypto", () => {
  it("A) cifra y descifra un objeto de secretos de Google correctamente (round-trip)", () => {
    const secrets = { provider: "GOOGLE" as const, verificationKey: "clave-secreta-de-google-123" };
    const encrypted = encryptConnectorSecretsObject(secrets);
    expect(encrypted).not.toContain("clave-secreta-de-google-123");
    const decrypted = decryptConnectorSecretsObject(encrypted);
    expect(decrypted).toEqual(secrets);
  });

  it("B) cifra y descifra un objeto de secretos de Meta correctamente (round-trip)", () => {
    const secrets = {
      provider: "META" as const,
      appSecret: "app-secret-xyz",
      pageAccessToken: "page-token-abc",
      verifyToken: "verify-token-123",
      pageId: "1234567890",
    };
    const encrypted = encryptConnectorSecretsObject(secrets);
    const decrypted = decryptConnectorSecretsObject(encrypted);
    expect(decrypted).toEqual(secrets);
  });

  it("C) un formato de almacenamiento no reconocido falla al descifrar", () => {
    expect(() => decryptConnectorSecrets("not-a-valid-format")).toThrow();
  });

  it("D) dos cifrados del mismo valor producen textos distintos (IV aleatorio)", () => {
    const plaintext = JSON.stringify({ a: 1 });
    const first = encryptConnectorSecrets(plaintext);
    const second = encryptConnectorSecrets(plaintext);
    expect(first).not.toBe(second);
    expect(decryptConnectorSecrets(first)).toBe(plaintext);
    expect(decryptConnectorSecrets(second)).toBe(plaintext);
  });

  it("E) la subclave se deriva de forma determinista (mismo PII_ENCRYPTION_KEY -> mismo resultado descifrable tras limpiar el caché)", () => {
    const secrets = { provider: "GOOGLE" as const, verificationKey: "otra-clave" };
    const encrypted = encryptConnectorSecretsObject(secrets);
    _resetLeadConnectorCryptoKeyCacheForTests();
    expect(decryptConnectorSecretsObject(encrypted)).toEqual(secrets);
  });
});
