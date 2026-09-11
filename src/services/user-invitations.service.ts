import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { activateAccountSchema, resendInvitationSchema } from "@/schemas/user-invitation.schema";
import { recordAuditEvent } from "@/services/audit.service";
import { sendEmail } from "@/lib/email";
import { renderTransactionalEmail, escapeHtml } from "@/lib/email-templates";
import { buildAppUrl } from "@/lib/env";
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
const RESEND_RATE_LIMIT = 5; // reenvíos por ADMIN cada hora — ver ficha "Protección contra abuso"
const RESEND_RATE_WINDOW_MS = 60 * 60 * 1000;
const ACTIVATE_RATE_LIMIT = 10; // intentos por invitación cada 15 minutos
const ACTIVATE_RATE_WINDOW_MS = 15 * 60 * 1000;
// Límite adicional por IP — independiente del límite por invitación de
// arriba: sin esto, alguien podría probar tokens contra MUCHAS
// invitaciones distintas desde la misma IP sin que ningún límite
// individual se activara nunca.
const ACTIVATE_IP_RATE_LIMIT = 30;
const ACTIVATE_IP_RATE_WINDOW_MS = 15 * 60 * 1000;

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
  return buildAppUrl("/activate", { uid: userId, token: rawToken });
}

function invitationEmailContent(name: string, url: string) {
  const safeName = escapeHtml(name);
  return renderTransactionalEmail({
    subject: "Activa tu cuenta — Tu Plan Seguro USA",
    bodyHtml: `<p>Hola ${safeName},</p><p>Se creó una cuenta para ti en el CRM de Tu Plan Seguro USA. Usa el siguiente botón para crear tu contraseña (válido por 24 horas, un solo uso):</p>`,
    bodyText: `Hola ${name},\n\nSe creó una cuenta para ti en el CRM de Tu Plan Seguro USA. Usa el siguiente enlace para crear tu contraseña (válido por 24 horas, un solo uso):`,
    ctaLabel: "Activar mi cuenta",
    ctaUrl: url,
    ignoreNotice: "Si no esperabas este correo, ignóralo — nadie podrá activar la cuenta sin este enlace.",
  });
}

function activationNoticeEmailContent(name: string) {
  const safeName = escapeHtml(name);
  return renderTransactionalEmail({
    subject: "Tu cuenta ya está activa — Tu Plan Seguro USA",
    bodyHtml: `<p>Hola ${safeName},</p><p>Tu cuenta en el CRM de Tu Plan Seguro USA ya está activa. Ya puedes iniciar sesión con tu correo y la contraseña que acabas de crear.</p>`,
    bodyText: `Hola ${name},\n\nTu cuenta en el CRM de Tu Plan Seguro USA ya está activa. Ya puedes iniciar sesión con tu correo y la contraseña que acabas de crear.`,
    ignoreNotice: "Si no reconoces esta actividad, contacta a un administrador de inmediato.",
  });
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

// PREPRODUCCIÓN — revocar una invitación pendiente. Borra la fila de
// Verification (el enlace ya emitido deja de ser válido de inmediato,
// mismo mecanismo que ya usa un reenvío para invalidar el anterior) sin
// emitir ningún token nuevo. Idempotente: revocar una invitación que ya
// no existe (o que nunca existió) no es un error — el resultado neto
// deseado ("esta persona no puede activarse con un enlace viejo") ya es
// cierto.
export async function revokeInvitation(actor: AuthorizedUser, rawInput: unknown): Promise<{ success: true }> {
  assertAdminOnly(actor);
  const input = parseOrThrow(resendInvitationSchema, rawInput);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, activatedAt: true },
  });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  if (user.activatedAt) {
    throw new AppError("VALIDATION_ERROR", "Esta cuenta ya fue activada — no tiene una invitación pendiente.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.verification.deleteMany({ where: { identifier: invitationIdentifier(user.id) } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: user.id,
      action: "USER_INVITATION_REVOKED",
      summary: `Invitación revocada para ${user.name}`,
    });
  });

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

// Extrae la IP del cliente de los headers del proxy — nunca confía en
// un único header sin respaldo (algunos proxies solo fijan uno u otro);
// "unknown" agrupa el tráfico sin ningún header reconocible bajo una
// sola clave, en vez de omitir el límite por IP por completo para ese
// caso.
function clientIpFrom(requestHeaders?: Headers): string {
  const forwardedFor = requestHeaders?.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return requestHeaders?.get("x-real-ip")?.trim() || "unknown";
}

// Pública (sin sesión) — la persona todavía no puede autenticarse.
// Nunca confía en nada del cliente más allá del token/userId: siempre
// vuelve a validar contra lo guardado en DB. `requestHeaders` es
// opcional (compatibilidad con callers existentes/pruebas) — cuando se
// pasa, se usa además del límite por invitación un límite por IP, para
// que alguien no pueda probar tokens contra MUCHAS invitaciones
// distintas desde la misma IP sin que ningún límite individual se
// active nunca (ver ACTIVATE_IP_RATE_LIMIT arriba).
export async function activateAccount(rawInput: unknown, requestHeaders?: Headers) {
  const input = parseOrThrow(activateAccountSchema, rawInput);

  if (!checkRateLimit(`activate:${input.userId}`, ACTIVATE_RATE_LIMIT, ACTIVATE_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
  }
  if (requestHeaders) {
    const ip = clientIpFrom(requestHeaders);
    if (!checkRateLimit(`activate-ip:${ip}`, ACTIVATE_IP_RATE_LIMIT, ACTIVATE_IP_RATE_WINDOW_MS)) {
      throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
    }
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

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, email: true } });
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

  // Aviso de activación — mejor esfuerzo, NUNCA revierte la activación
  // ya confirmada si el correo falla (la cuenta ya está activa y
  // utilizable; el aviso es una cortesía, no parte del contrato de
  // seguridad de esta operación).
  try {
    const { subject, html, text } = activationNoticeEmailContent(user.name);
    await sendEmail({ to: user.email, subject, html, text });
  } catch {
    // Silenciosamente ignorado — ver comentario arriba.
  }

  return { success: true as const };
}
