import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — "Bootstrap funciona una sola vez". Invoca el script
// REAL (`scripts/create-admin.ts`) como un proceso hijo, exactamente
// como lo ejecutaría un operador — nunca reimplementa su lógica de
// guarda en el test.
//
// SOLO se prueba la rama "ya existe un ADMIN → se rechaza": la base de
// datos de desarrollo/pruebas de este proyecto SIEMPRE tiene al menos
// un ADMIN real (bootstrap ya completado hace fases) — crear la
// condición "cero ADMIN" solo para esta prueba implicaría desactivar o
// borrar temporalmente usuarios reales, algo que este proyecto nunca
// hace en sus pruebas (ver docs/DECISIONS.md, fixtures sintéticos
// aislados). La otra rama (crea correctamente cuando NO existe ningún
// ADMIN) ya se ejerció una vez, de verdad, para arrancar este mismo
// entorno — no es simulable de forma segura en una suite que corre
// repetidamente contra la misma base compartida.
// ---------------------------------------------------------------------------

describe("scripts/create-admin.ts — bootstrap del primer ADMIN", () => {
  it("se rechaza incondicionalmente en cuanto ya existe un ADMIN, sin importar el correo", async () => {
    const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    expect(existingAdmin).not.toBeNull(); // precondición: este entorno ya completó su bootstrap

    let stdout = "";
    let exitCode = 0;
    try {
      stdout = execFileSync(
        "npx",
        ["tsx", "scripts/create-admin.ts", `--name=Bootstrap Rechazado`, `--email=nunca-se-crea-${Date.now()}@test.local`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, shell: true }
      );
    } catch (error) {
      const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      exitCode = err.status ?? 1;
      stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("Ya existe al menos un administrador");

    // Nunca se creó el usuario que el intento rechazado pretendía crear.
    const shouldNotExist = await prisma.user.findFirst({ where: { email: { contains: "nunca-se-crea-" } } });
    expect(shouldNotExist).toBeNull();
  });
});
