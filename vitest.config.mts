import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Fase 1.1 — INCIDENTE: correr el test suite contra la base de dev
// (tuplanseguro_crm) borró 106 CommissionPayment reales por un
// deleteMany mal acotado en un test. Desde este incidente, TODA
// ejecución de vitest usa EXCLUSIVAMENTE tuplanseguro_crm_test — nunca
// .env (dev). Se carga aquí, en el config, con override:true, ANTES de
// que cualquier setup file o test se importe, para que sea imposible
// que un DATABASE_URL de dev ya presente en el proceso se cuele. El
// guard real (que aborta la suite si esto fallara) vive en
// src/lib/test-db-guard.ts, ejecutado desde vitest.setup.ts.
loadDotenv({ path: ".env.test", override: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Ver vitest.server-only-shim.ts.
      "server-only": fileURLToPath(new URL("./vitest.server-only-shim.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Pruebas de integración contra el PostgreSQL local real (mismo
    // patrón usado en cada migración): no se mockea Prisma.
    testTimeout: 20000,
    // dashboard.service.test.ts (Fase 018) verifica conteos agregados
    // sin ningún filtro que los aísle (a diferencia del resto de los
    // tests, que siempre acotan con un `search` único) — es inherente
    // al propio Dashboard, que no acepta filtros de negocio. Correr
    // los archivos de test en paralelo permite que otro archivo cree/
    // borre pólizas o tareas mientras esos conteos se miden, dando
    // falsos negativos intermitentes. Desactivar el paralelismo entre
    // archivos es más simple y correcto que rediseñar el Dashboard
    // para aceptar un filtro que no tiene sentido de negocio.
    fileParallelism: false,
  },
});
