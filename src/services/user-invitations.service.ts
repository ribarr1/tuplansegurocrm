import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { activateAccountSchema, resendInvitationSchema } from "@/schemas/user-invitation.schema";
import { recordAuditEvent } from "@/services/audit.service";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// CORRECCIÓN (activación de usuarios) — invitación de un solo uso para
// que un usuario nuevo establezca su propia contraseña. El ADMIN nunca
// define ni conoce esa contraseña (reemplaza el flujo anterior de
// "contraseña temporal" que el ADMIN copiaba y entregaba a mano).
//
// Reutiliza la tabla `Verification` YA EXISTENTE en el schema
// (provisionada desde hace fases exactamente para "verificación de
// email, reset de password", nunca usada hasta ahora) en vez de crear
// una tabla nueva — `identifier = "invite:<userId>"`, `value` = HASH
// sha256 del token (nunca el token en claro). El token real de un solo
// uso viaja SOLO en el enlace del correo, nunca se persiste en claro
// en ningún lugar (ver docs/SECURITY.md).
//
// Un token nuevo (invitación inicial o reenvío) borra cualquier fila
// anterior con el mismo identifier antes de insertar la nueva — así un
// enlace previo deja de ser válido de inmediato (su hash ya no
// coincide con nada guardado), sin necesitar una columna extra de
// "invalidado".
//
// La recuperación de contraseña para cuentas YA activas usa el flujo
// NATIVO de Better Auth (emailAndPassword.sendResetPassword en
// auth.ts) — nunca este módulo. Este servicio es exclusivamente para
// la activación INICIAL de una cuenta nueva, donde Better Auth no
// tiene un concepto de "invitación" (su signup está deshabilitado a
// propósito, ver disableSignUp en auth.ts) y donde además se necesita
// visibilidad administrativa (pendiente/vencida/reenviar) que su
// endpoint de reset no expone.
// ---------------------------------------------------------------------------

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const RESEND_RATE_LIMIT = 5; // reenvíos por ADMIN cada 15 minutos
const RESEND_RATE_WINDOW_MS = 15 * 60 * 1000;
const ACTIVATE_RATE_LIMIT = 10; // intentos por invitación cada 15 minutos
const ACTIVATE_RATE_WINDOW_MS = 15 * 60 * 1000;

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede reenviar invitaciones.");
  }
}

function invitationIdentifier(userId: string): string {
  return `invite:${userId}`;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function buildActivationUrl(userId: string, rawToken: string): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const url = new URL("/activate", base);
  url.searchParams.set("uid", userId);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function invitationEmailContent(name: string, url: string): { subject: string; html: string; text: string } {
  const subject = "Activa tu cuenta — Tu Plan Seguro USA";
  const text = `Hola ${name},\n\nSe creó una cuenta para ti en el CRM de Tu Plan Seguro USA. Usa el siguiente enlace para crear tu contraseña (válido por 24 horas, un solo uso):\n\n${url}\n\nSi no esperabas este correo, ignóralo.`;
  const html = `<p>Hola ${name},</p><p>Se creó una cuenta para ti en el CRM de Tu Plan Seguro USA. Usa el siguiente enlace para crear tu contraseña (válido por 24 horas, un solo uso):</p><p><a href="${url}">${url}</a></p><p>Si no esperabas este correo, ignóralo.</p>`;
  return { subject, html, text };
}

// Escribe/reemplaza el token de invitación — SOLO base de datos, nunca
// una llamada de red aquí (ver el motivo en el comentario de
// issueInvitationEmail más abajo). Llamable dentro de una transacción
// existente (createUser) o para generar uno nuevo por separado
// (resendInvitation).
async function writeInvitationToken(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  await tx.verification.deleteMany({ where: { identifier: invitationIdentifier(userId) } });
  const rawToken = generateRawToken();
  await tx.verification.create({
    data: {
      identifier: invitationIdentifier(userId),
      value: hashToken(rawToken),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  return rawToken;
}

// El envío de correo NUNCA ocurre dentro de una transacción de DB —
// una llamada de red lenta (o que falle) no debe dejar una transacción
// abierta ni bloquear filas. El caller decide qué hacer si el envío
// falla (ver createUser/resendInvitation): el token YA quedó guardado
// en DB de cualquier forma, así que un reenvío posterior siempre puede
// recuperarlo sin volver a crear nada.
async function sendInvitationEmail(params: { userId: string; name: string; email: string; rawToken: string }): Promise<void> {
  const url = buildActivationUrl(params.userId, params.rawToken);
  const { subject, html, text } = invitationEmailContent(params.name, url);
  await sendEmail({ to: params.email, subject, html, text });
}

// Llamado DESDE la transacción de users.service.ts::createUser — solo
// escribe el token (DB), nunca envía el correo (eso lo hace el caller
// DESPUÉS de que la transacción confirme, ver más abajo).
export async function issueInvitationToken(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  return writeInvitationToken(tx, userId);
}

export { sendInvitationEmail };

export async function resendInvitation(actor: AuthorizedUser, rawInput: unknown): Promise<{ success: true }> {
  assertAdminOnly(actor);
  const input = parseOrThrow(resendInvitationSchema, rawInput);

  if (!checkRateLimit(`resend-invitation:${actor.id}`, RESEND_RATE_LIMIT, RESEND_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados reenvíos — espera unos minutos antes de intentar de nuevo.");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, activatedAt: true },
  });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  if (user.activatedAt) {
    throw new AppError("VALIDATION_ERROR", "Esta cuenta ya fue activada — no tiene una invitación pendiente.");
  }

  const rawToken = await prisma.$transaction(async (tx) => {
    const token = await writeInvitationToken(tx, user.id);
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: user.id,
      action: "USER_INVITATION_RESENT",
      summary: `Invitación reenviada a ${user.name}`,
    });
    return token;
  });

  // El token ya quedó guardado (y el anterior invalidado) aunque el
  // envío falle — el ADMIN puede volver a intentar "Reenviar" una vez
  // resuelto el problema de configuración, sin duplicar auditoría de
  // creación ni tocar al usuario de nuevo.
  await sendInvitationEmail({ userId: user.id, name: user.name, email: user.email, rawToken });

  return { success: true };
}

export type InvitationStatus = "PENDING" | "EXPIRED" | "ACTIVATED";

// Usado por la lista de Usuarios (ADMIN) para mostrar el badge
// correcto — una sola consulta por lote, nunca N+1 por fila.
export async function getInvitationStatuses(
  users: { id: string; activatedAt: Date | null }[]
): Promise<Map<string, InvitationStatus>> {
  const pendingIds = users.filter((u) => !u.activatedAt).map((u) => u.id);
  const result = new Map<string, InvitationStatus>();
  for (const u of users) {
    if (u.activatedAt) result.set(u.id, "ACTIVATED");
  }
  if (pendingIds.length === 0) return result;

  const verifications = await prisma.verification.findMany({
    where: { identifier: { in: pendingIds.map(invitationIdentifier) } },
    select: { identifier: true, expiresAt: true },
  });
  const expiresByUserId = new Map(
    verifications.map((v) => [v.identifier.replace(/^invite:/, ""), v.expiresAt])
  );
  const now = new Date();
  for (const id of pendingIds) {
    const expiresAt = expiresByUserId.get(id);
    result.set(id, expiresAt && expiresAt > now ? "PENDING" : "EXPIRED");
  }
  return result;
}

// Pública (sin sesión) — la persona todavía no puede autenticarse.
// Nunca confía en nada del cliente más allá del token/userId: siempre
// vuelve a validar contra lo guardado en DB.
export async function activateAccount(rawInput: unknown) {
  const input = parseOrThrow(activateAccountSchema, rawInput);

  if (!checkRateLimit(`activate:${input.userId}`, ACTIVATE_RATE_LIMIT, ACTIVATE_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
  }

  const record = await prisma.verification.findFirst({
    where: { identifier: invitationIdentifier(input.userId) },
  });
  if (!record) {
    throw new AppError("VALIDATION_ERROR", "Este enlace de activación no es válido o ya fue utilizado.");
  }
  if (record.expiresAt < new Date()) {
    throw new AppError("VALIDATION_ERROR", "Este enlace de activación venció — pide a un administrador que lo reenvíe.");
  }
  if (record.value !== hashToken(input.token)) {
    throw new AppError("VALIDATION_ERROR", "Este enlace de activación no es válido o ya fue utilizado.");
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true } });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");

  const hashedPassword = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.verification.delete({ where: { id: record.id } }); // un solo uso: se borra al consumirse
    await tx.account.updateMany({
      where: { userId: input.userId, providerId: "credential" },
      data: { password: hashedPassword },
    });
    await tx.user.update({ where: { id: input.userId }, data: { activatedAt: new Date() } });
    // Nunca token/contraseña en el resumen o metadata de auditoría.
    await recordAuditEvent(tx, {
      actor: null,
      entityType: "User",
      entityId: input.userId,
      action: "USER_ACTIVATED",
      summary: `Cuenta activada: ${user.name}`,
    });
  });

  return { success: true as const };
}
