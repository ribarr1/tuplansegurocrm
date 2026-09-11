import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/prisma";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — MFA, Sección 7: "Para pérdida total del autenticador
// y códigos: crear un procedimiento administrativo local/manual.
// Requerir verificación humana de identidad fuera del CRM. No crear
// preguntas de seguridad. No crear puertas traseras permanentes."
//
// Este script NUNCA se expone como endpoint HTTP — se ejecuta a mano,
// localmente, por un operador con acceso directo al servidor/base de
// datos (mismo criterio de "herramienta local, no ruta pública" ya
// usado por create-admin.ts y dev-issue-local-link.ts). Antes de
// ejecutarlo, el operador debe haber verificado la identidad del
// usuario POR UN MEDIO FUERA DEL CRM (llamada telefónica conocida,
// verificación en persona, etc.) — este script no lo hace ni puede
// hacerlo, y no ofrece ninguna alternativa automatizada (sin preguntas
// de seguridad, sin enlace por correo).
//
// Efecto: borra el registro TwoFactor del usuario (secreto y códigos
// de recuperación quedan inutilizables), pone twoFactorEnabled=false,
// y revoca TODAS sus sesiones. El usuario deberá volver a configurar
// MFA desde cero la próxima vez que inicie sesión — si es ADMIN, el
// mismo mecanismo obligatorio de (app)/layout.tsx se lo exige de
// nuevo, exactamente igual que a un ADMIN recién creado.
//
// Uso:
//   npx tsx scripts/mfa-admin-recovery.ts --email=admin@ejemplo.com
// ---------------------------------------------------------------------------

function parseCliArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
    else if (arg.startsWith("--")) args[arg.slice(2)] = "true";
  }
  return args;
}

async function main() {
  const cliArgs = parseCliArgs();
  const email = cliArgs.email ?? (await (async () => {
    const rl = createInterface({ input: stdin, output: stdout });
    const value = await rl.question("Correo del usuario a recuperar: ");
    rl.close();
    return value;
  })());

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, twoFactorEnabled: true },
  });
  if (!user) {
    console.error(`No existe ningún usuario con el correo ${email}.`);
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\nUsuario: ${user.name} <${user.email}> (rol: ${user.role})`);
  console.log("Este procedimiento asume que YA verificaste la identidad de esta persona por un medio fuera del CRM.");
  const confirmation = await rl.question(
    `Escribe exactamente "${user.email}" para confirmar la recuperación de MFA: `
  );
  rl.close();

  if (confirmation !== user.email) {
    console.error("Confirmación incorrecta — no se realizó ningún cambio.");
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    // Auditoría directa (nunca recordAuditEvent de audit.service.ts —
    // ese módulo es "server-only" y este script corre fuera del árbol
    // de Next vía tsx, mismo motivo ya documentado en create-admin.ts).
    await tx.auditEvent.create({
      data: {
        actorUserId: null,
        actorType: "SYSTEM",
        entityType: "User",
        entityId: user.id,
        action: "MFA_ADMINISTRATIVE_RECOVERY",
        summary: `Recuperación administrativa de MFA ejecutada localmente para ${user.name} (${user.email}) — deberá configurar MFA nuevamente`,
      },
    });
  });

  console.log(`MFA restablecido para ${user.email}. Todas sus sesiones fueron cerradas.`);
  console.log("Deberá configurar MFA nuevamente antes de poder usar el CRM (si es ADMIN, es obligatorio).");
}

main()
  .catch((e) => {
    console.error("Error en la recuperación administrativa de MFA:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
