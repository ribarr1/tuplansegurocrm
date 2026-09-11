import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — herramienta de DESARROLLO para pruebas manuales, sin
// depender de tener Resend configurado localmente.
//
// Por diseño, el token real de una invitación NUNCA se guarda en claro
// en ningún lado (solo su hash SHA-256, ver user-invitations.service.ts)
// — así que no existe forma de "recuperar" el enlace de una invitación
// YA emitida. Lo que esta herramienta hace es EMITIR una invitación
// nueva (invalidando cualquiera anterior, mismo mecanismo que "Reenviar
// invitación") e imprimir el enlace resultante en la terminal LOCAL,
// sin enviar ningún correo — para poder probar el flujo de activación a
// mano sin un proveedor de correo configurado.
//
// BLOQUEADA EN PRODUCCIÓN: se niega a ejecutarse si NODE_ENV=production,
// sin excepción. Nunca escribe el enlace en un archivo ni en ningún log
// persistente — solo stdout de esta ejecución puntual.
// ---------------------------------------------------------------------------

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Esta herramienta está deshabilitada en producción (NODE_ENV=production).");
    process.exitCode = 1;
    return;
  }

  const email = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1]?.trim().toLowerCase();
  if (!email) {
    console.error("Uso: npm run dev:issue-local-link -- --email=usuario@example.com");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, activatedAt: true },
  });
  if (!user) {
    console.error(`No existe ningún usuario con el correo ${email}.`);
    process.exitCode = 1;
    return;
  }
  if (user.activatedAt) {
    console.error(`${user.name} ya activó su cuenta — no tiene una invitación pendiente que emitir.`);
    process.exitCode = 1;
    return;
  }

  const rawToken = generateRawToken();
  const identifier = `invite:${user.id}`;

  await prisma.$transaction(async (tx) => {
    await tx.verification.deleteMany({ where: { identifier } });
    await tx.verification.create({
      data: { identifier, value: hashToken(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: null,
        actorType: "SYSTEM",
        entityType: "User",
        entityId: user.id,
        action: "USER_INVITATION_RESENT",
        summary: `Invitación reemitida localmente (herramienta de desarrollo) para ${user.name}`,
      },
    });
  });

  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const url = new URL("/activate", `${base}/`);
  url.searchParams.set("uid", user.id);
  url.searchParams.set("token", rawToken);

  console.log(`\nEnlace de activación para ${user.name} (${user.email}) — válido 24 horas, un solo uso:`);
  console.log(url.toString());
  console.log("\nEste enlace NO se envió por correo ni se guardó en ningún archivo — cópialo ahora si lo necesitas.");
}

main()
  .catch((e) => {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
