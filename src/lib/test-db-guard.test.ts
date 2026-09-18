import { describe, it, expect } from "vitest";
import { assertTestDatabase, TestDatabaseGuardError } from "./test-db-guard";

// Fase 1.1 — prueba del guard que existe precisamente para que el
// incidente de borrado de datos reales (Fase 1.1) nunca se repita.
// Nunca se prueba llamando a assertTestDatabase() sin argumentos (eso
// leería el process.env REAL de esta propia ejecución de vitest, que
// ya pasó el guard real) — siempre se le pasa un entorno sintético.
describe("assertTestDatabase", () => {
  const validEnv = { NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@localhost:5433/tuplanseguro_crm_test?schema=public" };

  it("no lanza con la base de pruebas correcta y NODE_ENV=test", () => {
    expect(() => assertTestDatabase(validEnv)).not.toThrow();
  });

  it("rechaza si NODE_ENV no es 'test'", () => {
    expect(() => assertTestDatabase({ ...validEnv, NODE_ENV: "development" })).toThrow(TestDatabaseGuardError);
    expect(() => assertTestDatabase({ ...validEnv, NODE_ENV: undefined })).toThrow(TestDatabaseGuardError);
  });

  it("rechaza si DATABASE_URL falta", () => {
    expect(() => assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: undefined })).toThrow(TestDatabaseGuardError);
  });

  it("rechaza explícitamente la base de DEV (tuplanseguro_crm) — el caso exacto del incidente", () => {
    expect(() =>
      assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@localhost:5433/tuplanseguro_crm?schema=public" })
    ).toThrow(TestDatabaseGuardError);
  });

  it("rechaza nombres de staging/producción conocidos aunque NODE_ENV diga 'test'", () => {
    for (const db of ["tuplanseguro_crm_staging", "tuplanseguro_crm_prod", "tuplanseguro_crm_production"]) {
      expect(() =>
        assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: `postgresql://user:pass@remote-host:5432/${db}?schema=public` })
      ).toThrow(TestDatabaseGuardError);
    }
  });

  it("rechaza cualquier otro nombre de base no reconocido — nunca asume que 'desconocido' es seguro", () => {
    expect(() =>
      assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@localhost:5433/algo_random?schema=public" })
    ).toThrow(TestDatabaseGuardError);
  });

  it("rechaza un DATABASE_URL que no es una URL válida, en vez de lanzar un error distinto sin explicar", () => {
    expect(() => assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: "no-es-una-url" })).toThrow(TestDatabaseGuardError);
  });

  it("el mensaje de error nunca incluye la URL completa (podría llevar credenciales)", () => {
    const secretUrl = "postgresql://realuser:realsecretpassword@prod-host.internal:5432/tuplanseguro_crm";
    try {
      assertTestDatabase({ NODE_ENV: "test", DATABASE_URL: secretUrl });
      throw new Error("se esperaba que lanzara");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain("realsecretpassword");
      expect(message).not.toContain("prod-host.internal");
    }
  });
});
