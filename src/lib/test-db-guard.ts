// ---------------------------------------------------------------------------
// Fase 1.1 — GUARD DE SEGURIDAD (incidente: un deleteMany mal acotado
// en un test corrió contra tuplanseguro_crm, la base de DEV con datos
// reales importados, y borró 106 CommissionPayment reales). Este guard
// se ejecuta UNA vez, al arrancar el test suite (vitest.setup.ts), y
// aborta el proceso INMEDIATAMENTE (antes de que cualquier test corra
// un solo deleteMany/createMany) si el entorno no es, sin ninguna
// ambigüedad, la base de datos de pruebas dedicada.
//
// Deliberadamente estricto por ALLOWLIST (nunca por blocklist): en vez
// de intentar enumerar todos los nombres posibles de bases "peligrosas"
// (dev, staging, prod, y cualquier nombre futuro que alguien invente),
// exige que DATABASE_URL apunte EXACTAMENTE a la base con el nombre
// esperado de pruebas — cualquier otra cosa se rechaza, incluida
// tuplanseguro_crm (dev) por nombre explícito además de por no calzar
// el allowlist.
// ---------------------------------------------------------------------------

const EXPECTED_TEST_DB_NAME = "tuplanseguro_crm_test";

// Nombres que NUNCA deben ejecutar un test suite, ni aunque alguien
// los agregara por error al allowlist en el futuro — verificación
// explícita y redundante al allowlist, nunca solo implícita.
const KNOWN_NON_TEST_DB_NAMES = ["tuplanseguro_crm", "tuplanseguro_crm_staging", "tuplanseguro_crm_prod", "tuplanseguro_crm_production"];

export class TestDatabaseGuardError extends Error {}

function extractDatabaseName(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    // pathname es "/nombre_db" o "/nombre_db" con query aparte (schema=...)
    const name = url.pathname.replace(/^\//, "").split("?")[0];
    return name || null;
  } catch {
    return null;
  }
}

// Nunca imprime el DATABASE_URL completo (podría llevar credenciales) —
// solo el nombre de la base, que ya es seguro de mostrar.
export function assertTestDatabase(env: { NODE_ENV?: string; DATABASE_URL?: string } = process.env): void {
  if (env.NODE_ENV !== "test") {
    throw new TestDatabaseGuardError(
      `Guard de base de datos de pruebas: NODE_ENV es "${env.NODE_ENV}", se esperaba "test". Abortando antes de ejecutar cualquier prueba.`
    );
  }

  if (!env.DATABASE_URL) {
    throw new TestDatabaseGuardError("Guard de base de datos de pruebas: DATABASE_URL no está definida. Abortando.");
  }

  const dbName = extractDatabaseName(env.DATABASE_URL);
  if (!dbName) {
    throw new TestDatabaseGuardError("Guard de base de datos de pruebas: no se pudo determinar el nombre de la base desde DATABASE_URL. Abortando.");
  }

  if (KNOWN_NON_TEST_DB_NAMES.includes(dbName)) {
    throw new TestDatabaseGuardError(
      `Guard de base de datos de pruebas: DATABASE_URL apunta a "${dbName}", una base NO destinada a pruebas (dev/staging/producción). Abortando — esto es exactamente lo que causó el incidente de borrado de datos reales. Usa .env.test (base "${EXPECTED_TEST_DB_NAME}").`
    );
  }

  if (dbName !== EXPECTED_TEST_DB_NAME) {
    throw new TestDatabaseGuardError(
      `Guard de base de datos de pruebas: DATABASE_URL apunta a "${dbName}", pero se esperaba exactamente "${EXPECTED_TEST_DB_NAME}". Abortando — nunca se asume que un nombre desconocido es seguro.`
    );
  }
}
