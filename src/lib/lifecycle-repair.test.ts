import { describe, it, expect } from "vitest";
import { shouldRestoreExpiredPolicyToActive } from "@/lib/lifecycle-repair";

// Fase 025.2 (incidente de datos real, item 9 de la ficha de UAT):
// una póliza EXPIRED solo se restaura a ACTIVE con evidencia clara
// (AuditEvent POLICY_AUTO_EXPIRED) de que un job automático la causó,
// Y su terminationDate real sigue siendo hoy o futura respecto al
// businessDate — nunca por el solo hecho de tener el evento faulty.
describe("lifecycle-repair — shouldRestoreExpiredPolicyToActive", () => {
  const businessDate = new Date(Date.UTC(2026, 8, 4)); // 2026-09-04

  it("9a) EXPIRED con evidencia + terminationDate futura -> SÍ se restaura", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: new Date(Date.UTC(2026, 11, 31)), hasAutoExpiredEvent: true },
      businessDate
    );
    expect(result).toBe(true);
  });

  it("9b) EXPIRED con evidencia pero terminationDate ya pasada -> NUNCA se restaura (expiración legítima)", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: new Date(Date.UTC(2025, 11, 31)), hasAutoExpiredEvent: true },
      businessDate
    );
    expect(result).toBe(false);
  });

  it("9c) EXPIRED sin evidencia de AuditEvent (ej. HEALTH 2025 legítima) -> NUNCA se restaura", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: new Date(Date.UTC(2026, 11, 31)), hasAutoExpiredEvent: false },
      businessDate
    );
    expect(result).toBe(false);
  });

  it("9d) CANCELLED nunca se restaura, aunque tenga evidencia y fecha futura", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "CANCELLED", terminationDate: new Date(Date.UTC(2026, 11, 31)), hasAutoExpiredEvent: true },
      businessDate
    );
    expect(result).toBe(false);
  });

  it("9e) sin terminationDate -> nunca se restaura (no se puede evaluar con seguridad)", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: null, hasAutoExpiredEvent: true },
      businessDate
    );
    expect(result).toBe(false);
  });

  it("9f) terminationDate == businessDate -> SÍ se restaura (sigue vigente ese mismo día)", () => {
    const result = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: businessDate, hasAutoExpiredEvent: true },
      businessDate
    );
    expect(result).toBe(true);
  });
});
