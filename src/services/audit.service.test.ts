import { describe, it, expect } from "vitest";
import { buildDiff } from "@/services/audit.service";
import { Prisma } from "@/generated/prisma/client";

// Fase 019.9 — buildDiff es la base de "changes" en AuditEvent: unit
// tests puros (sin DB) sobre su comportamiento de comparación/
// serialización, independiente de cualquier servicio concreto.
describe("audit.service — buildDiff", () => {
  it("B) captura before/after de un campo que realmente cambió", () => {
    const changes = buildDiff({ city: "Aurora" }, { city: "Naperville" }, ["city"]);
    expect(changes).toEqual({ city: { before: "Aurora", after: "Naperville" } });
  });

  it("C) omite campos sin cambio real (before === after)", () => {
    const changes = buildDiff({ city: "Aurora", state: "IL" }, { city: "Aurora", state: "IN" }, [
      "city",
      "state",
    ]);
    expect(changes).toEqual({ state: { before: "IL", after: "IN" } });
  });

  it("omite campos ausentes en `after` (edición parcial: no se propuso tocar ese campo)", () => {
    const changes = buildDiff({ city: "Aurora", state: "IL" }, { city: "Naperville" }, [
      "city",
      "state",
    ]);
    expect(changes).toEqual({ city: { before: "Aurora", after: "Naperville" } });
  });

  it("retorna undefined cuando no hay ningún cambio real", () => {
    const changes = buildDiff({ city: "Aurora" }, { city: "Aurora" }, ["city"]);
    expect(changes).toBeUndefined();
  });

  it("W) nunca incluye un campo fuera de la allowlist explícita (redacción por diseño)", () => {
    const changes = buildDiff(
      { city: "Aurora", password: "secret123" },
      { city: "Naperville", password: "newsecret" },
      ["city"] // password nunca se pasa en `fields`
    );
    expect(changes).toEqual({ city: { before: "Aurora", after: "Naperville" } });
    expect(changes).not.toHaveProperty("password");
  });

  it("serializa Decimal como string, nunca como number (sin punto flotante)", () => {
    const changes = buildDiff(
      { premiumAmount: new Prisma.Decimal("125.50") },
      { premiumAmount: new Prisma.Decimal("130.00") },
      ["premiumAmount"]
    );
    expect(changes).toEqual({ premiumAmount: { before: "125.5", after: "130" } });
  });

  it("serializa Date como YYYY-MM-DD (date-only, sin desplazamiento de zona horaria)", () => {
    const changes = buildDiff(
      { effectiveDate: new Date("2026-01-01T00:00:00.000Z") },
      { effectiveDate: new Date("2026-06-15T00:00:00.000Z") },
      ["effectiveDate"]
    );
    expect(changes).toEqual({ effectiveDate: { before: "2026-01-01", after: "2026-06-15" } });
  });

  it("normaliza null/undefined a null explícito en ambos lados", () => {
    const changes = buildDiff({ notes: null }, { notes: "algo nuevo" }, ["notes"]);
    expect(changes).toEqual({ notes: { before: null, after: "algo nuevo" } });
  });

  it("un objeto vacío de before compara correctamente contra un valor nuevo", () => {
    const changes = buildDiff({}, { status: "ACTIVE" }, ["status"]);
    expect(changes).toEqual({ status: { before: null, after: "ACTIVE" } });
  });
});
