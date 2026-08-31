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
  },
});
