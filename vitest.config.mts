import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
