import { describe, it, expect } from "vitest";
import {
  normalizeSsn,
  isValidSsn,
  last4,
  formatSsnFull,
  maskSsn,
  normalizeIdentifier,
  maskUscisNumber,
  maskDocumentNumber,
} from "@/lib/sensitive-identity-format";

describe("sensitive-identity-format", () => {
  describe("SSN", () => {
    it("A) acepta un SSN válido con guiones", () => {
      expect(normalizeSsn("123-45-6789")).toBe("123456789");
      expect(isValidSsn("123-45-6789")).toBe(true);
    });

    it("A) acepta un SSN válido sin guiones", () => {
      expect(normalizeSsn("123456789")).toBe("123456789");
    });

    it("B) rechaza un SSN con menos de 9 dígitos", () => {
      expect(normalizeSsn("123-45-678")).toBeNull();
      expect(isValidSsn("123-45-678")).toBe(false);
    });

    it("B) rechaza un SSN con más de 9 dígitos", () => {
      expect(normalizeSsn("123-45-67890")).toBeNull();
    });

    it("B) rechaza un SSN con letras", () => {
      expect(normalizeSsn("123-45-678a")).toBeNull();
    });

    it("D) last4 extrae los últimos 4 dígitos", () => {
      expect(last4("123456789")).toBe("6789");
    });

    it("formatSsnFull produce 123-45-6789 a partir del valor normalizado", () => {
      expect(formatSsnFull("123456789")).toBe("123-45-6789");
    });

    it("H) maskSsn produce ***-**-6789", () => {
      expect(maskSsn("6789")).toBe("***-**-6789");
    });
  });

  describe("USCIS / A-Number y número de documento", () => {
    it("normalizeIdentifier recorta espacios y rechaza vacío", () => {
      expect(normalizeIdentifier("  A123456789  ")).toBe("A123456789");
      expect(normalizeIdentifier("   ")).toBeNull();
      expect(normalizeIdentifier("")).toBeNull();
    });

    it("H) maskUscisNumber produce *****1234 (5 asteriscos + last4)", () => {
      expect(maskUscisNumber("1234")).toBe("*****1234");
    });

    it("H) maskDocumentNumber produce ******9876 (6 asteriscos + last4)", () => {
      expect(maskDocumentNumber("9876")).toBe("******9876");
    });
  });
});
