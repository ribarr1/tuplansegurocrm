import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";

// CORRECCIÓN (activación de usuarios) — bootstrap seguro del PRIMER
// ADMIN. Reescrito: ya NUNCA recibe/define una contraseña (ni por
// prompt ni por env) — igual que un usuario creado desde Configuración
// → Usuarios, el primer ADMIN activa su propia cuenta mediante una
// invitación de un solo uso (misma tabla `Verification`, mismo
// mecanismo que user-invitations.service.ts — reutilizado aquí en
// lugar de importarlo, porque ese módulo es "server-only" y este
// script corre fuera del árbol de Next vía tsx, ver el mismo motivo
// documentado en apply-plan.ts/seed-ruben-compliance.ts).
//
// Bloquea nuevas ejecuciones en cuanto YA EXISTE un ADMIN — este
// comando es exclusivamente para el arranque inicial del sistema,
// nunca para crear administradores adicionales (eso se hace desde
// Configuración → Usuarios, con auditoría de qué ADMIN lo creó).
//
// Nunca escribe el token/enlace de invitación en un archivo ni lo deja
// en git — si el correo no está configurado (RESEND_API_KEY/
// EMAIL_FROM), se imprime UNA vez en la terminal como último recurso
// (con advertencia explícita) para que el operador que ejecuta este
// comando interactivamente pueda completar el arranque sin depender
// de otro canal — nunca se persiste en un log de archivo.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCliArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
    else if (arg.startsWith("--")) args[arg.slice(2)] = "true";
  }
  return args;
}

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function sendInviteEmailOrPrint(params: { name: string; email: string; url: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const subject = "Activa tu cuenta de administrador — Tu Plan Seguro USA";
  const text = `Hola ${params.name},\n\nUsa este enlace para crear tu contraseña de administrador (válido 24 horas, un solo uso):\n\n${params.url}`;
  const html = `<p>Hola ${params.name},</p><p>Usa este enlace para crear tu contraseña de administrador (válido 24 horas, un solo uso):</p><p><a href="${params.url}">${params.url}</a></p>`;

  if (apiKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: params.email, subject, html, text }),
    });
    if (response.ok) {
      console.log(`Invitación enviada por correo a ${params.email}.`);
      return;
    }
    console.warn("No se pudo enviar el correo de invitación (proveedor respondió con error).");
  } else {
    console.warn(
      "Correo no configurado (falta RESEND_API_KEY/EMAIL_FROM) — no se pudo enviar automáticamente."
    );
  }

  // Único caso en que el enlace se imprime: bootstrap interactivo sin
  // proveedor de correo configurado y sin otro ADMIN a quien
  // reenviársela. Nunca se escribe en un archivo ni se registra en un
  // log persistente — solo en esta terminal, una vez.
  console.log("\nComparte este enlace de activación de forma segura (válido 24 horas, un solo uso):");
  console.log(params.url);
}

async function main() {
  const cliArgs = parseCliArgs();
  const rl = createInterface({ input: stdin, output: stdout });

  const email = cliArgs.email ?? process.env.ADMIN_EMAIL ?? (await rl.question("Correo electrónico: "));
  const name = cliArgs.name ?? process.env.ADMIN_NAME ?? (await rl.question("Nombre completo: "));
  const isAgent = cliArgs.isAgent === "true" || process.env.ADMIN_IS_AGENT === "true";

  rl.close();

  if (!name.trim()) {
    console.error("El nombre no puede estar vacío.");
    process.exitCode = 1;
    return;
  }
  if (!isValidEmail(email)) {
    console.error("El correo electrónico no es válido.");
    process.exitCode = 1;
    return;
  }

  // Bloqueo real: nunca solo "¿ya existe este email?" — el comando es
  // de arranque inicial, se rechaza en cuanto EXISTE cualquier ADMIN,
  // sin importar su correo.
  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (existingAdmin) {
    console.error(
      "Ya existe al menos un administrador — este comando es solo para el arranque inicial. Crea administradores adicionales desde Configuración → Usuarios."
    );
    process.exitCode = 1;
    return;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.error(`Ya existe un usuario con el correo ${email}.`);
    process.exitCode = 1;
    return;
  }

  const rawToken = generateRawToken();
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name, email, role: "ADMIN", isActive: true, isAgent, activatedAt: null },
    });
    await tx.account.create({
      data: {
        issuer: "local:credential",
        providerId: "credential",
        accountId: created.id,
        userId: created.id,
        password: null,
      },
    });
    await tx.verification.create({
      data: {
        identifier: `invite:${created.id}`,
        value: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    // Auditoría del bootstrap — nunca el token, nunca ningún secreto.
    // `prisma.auditEvent.create` directo (no recordAuditEvent de
    // audit.service.ts): ese módulo es "server-only" y este script
    // corre fuera del árbol de Next vía tsx, mismo motivo ya documentado
    // arriba para no reutilizar user-invitations.service.ts.
    await tx.auditEvent.create({
      data: {
        actorUserId: null,
        actorType: "SYSTEM",
        entityType: "User",
        entityId: created.id,
        action: "ADMIN_BOOTSTRAP_CREATED",
        summary: `Primer administrador creado por bootstrap: ${created.name} (${created.email})`,
      },
    });
    return created;
  });

  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const url = new URL("/activate", base);
  url.searchParams.set("uid", user.id);
  url.searchParams.set("token", rawToken);

  console.log(`Usuario ADMIN creado correctamente: ${email}`);
  await sendInviteEmailOrPrint({ name, email, url: url.toString() });
}

main()
  .catch((e) => {
    console.error("Error creando el administrador:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
