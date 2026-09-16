import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// LIMPIEZA CONTROLADA DE BASE DEV — pruebas del script REAL
// (scripts/clean-dev-database.ts), invocado como subproceso — nunca
// reimplementa su lógica de guarda en el test (mismo criterio que
// scripts/create-admin.bootstrap.test.ts).
//
// SOLO se prueban las salvaguardas de seguridad y el modo --dry-run
// (de solo lectura). NUNCA se ejecuta --execute de verdad en esta
// suite: este script opera sobre la MISMA base compartida de
// desarrollo que usa el resto de la suite (y que además contiene los
// datos reales de identidad de ribarr1@gmail.com que la ficha exige
// preservar) — invocar la limpieza real de forma automática y
// repetible destruiría datos reales/compartidos en cada corrida, algo
// que este proyecto nunca hace en sus pruebas. La ruta de éxito real
// ya se verificó manualmente (dry-run + ejecución única, ver el
// reporte de esta fase).
// ---------------------------------------------------------------------------

function runScript(args: string[], env: Record<string, string | undefined> = {}): { status: number; output: string } {
  let output = "";
  let status = 0;
  try {
    output = execFileSync("npx", ["tsx", "scripts/clean-dev-database.ts", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      shell: true,
      env: { ...process.env, ...env },
    });
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    status = err.status ?? 1;
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  return { status, output };
}

describe("scripts/clean-dev-database.ts — salvaguardas (nunca ejecuta una limpieza real)", () => {
  it("A) se rechaza sin --dry-run ni --execute", () => {
    const { status, output } = runScript(["--preserve-user=ribarr1@gmail.com"]);
    expect(status).not.toBe(0);
    expect(output).toContain("Especifica --dry-run o --execute");
  });

  it("B) se rechaza sin --preserve-user", () => {
    const { status, output } = runScript(["--dry-run"]);
    expect(status).not.toBe(0);
    expect(output).toContain("Falta --preserve-user");
  });

  it("C) se rechaza si NODE_ENV=production, incluso en modo --dry-run", () => {
    const { status, output } = runScript(["--dry-run", "--preserve-user=ribarr1@gmail.com"], { NODE_ENV: "production" });
    expect(status).not.toBe(0);
    expect(output).toContain("producción");
  });

  it("D) se rechaza si DATABASE_URL no apunta a un host local", () => {
    const { status, output } = runScript(["--dry-run", "--preserve-user=ribarr1@gmail.com"], {
      DATABASE_URL: "postgresql://user:pass@remote-prod-host.example.com:5432/somedb",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("Host no reconocido como local");
    // Nunca debe filtrar el host completo ni credenciales en el mensaje.
    expect(output).not.toContain("remote-prod-host.example.com");
    expect(output).not.toContain("user:pass");
  });

  it("E) se rechaza si el correo a preservar no resuelve a exactamente 1 usuario", () => {
    const { status, output } = runScript(["--dry-run", `--preserve-user=no-existe-${Date.now()}@test.local`]);
    expect(status).not.toBe(0);
    expect(output).toContain("se encontraron 0");
  });

  it("F) --execute sin --confirm (o con un valor incorrecto) nunca aplica nada", () => {
    const { status, output } = runScript(["--execute", "--preserve-user=ribarr1@gmail.com"]);
    expect(status).not.toBe(0);
    expect(output).toContain("Falta o es incorrecta la confirmación exacta");

    const { status: status2, output: output2 } = runScript([
      "--execute",
      "--preserve-user=ribarr1@gmail.com",
      "--confirm=ALGO_INCORRECTO",
    ]);
    expect(status2).not.toBe(0);
    expect(output2).toContain("Falta o es incorrecta la confirmación exacta");
  }, 60_000);

  it("G) --dry-run contra el usuario real es de SOLO LECTURA: dos corridas consecutivas reportan el mismo total de usuarios", () => {
    const { status: status1, output: output1 } = runScript(["--dry-run", "--preserve-user=ribarr1@gmail.com"]);
    const { status: status2, output: output2 } = runScript(["--dry-run", "--preserve-user=ribarr1@gmail.com"]);
    expect(status1).toBe(0);
    expect(status2).toBe(0);
    expect(output1).toContain("DRY RUN — nada se modificó");
    expect(output1).toContain("Usuario a conservar:");
    // La misma fila de usuario, en el mismo estado, en ambas corridas —
    // ninguna de las dos pudo haber modificado la base.
    const extractUsersLine = (out: string) => out.split("\n").find((l) => l.trim().startsWith("users"));
    expect(extractUsersLine(output1)).toBe(extractUsersLine(output2));
  }, 60_000);

  it("H) el reporte del dry-run nunca imprime el password hash ni ningún secreto cifrado", () => {
    const { output } = runScript(["--dry-run", "--preserve-user=ribarr1@gmail.com"]);
    expect(output).not.toMatch(/"password":\s*"(?!null)/);
    expect(output.toLowerCase()).not.toContain("secret");
    expect(output.toLowerCase()).not.toContain("encrypted");
  }, 30_000);
});
