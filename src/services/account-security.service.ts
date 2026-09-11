import "server-only";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { recordAuditEvent } from "@/services/audit.service";
import { sendEmail } from "@/lib/email";
import { renderTransactionalEmail, escapeHtml } from "@/lib/email-templates";
import { checkRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — Sección 6: "Cambio de correo y contraseña" para un
// usuario YA AUTENTICADO (distinto de "olvidé mi contraseña", que es
// para alguien SIN sesión — ver password-recovery.service.ts, y de
// "restablecer contraseña de otro usuario", que es un ADMIN forzando la
// de alguien más — ver users.service.ts::resetUserPassword).
//
// Ambas operaciones usan los endpoints NATIVOS de Better Auth
// (auth.api.changePassword / auth.api.changeEmail) — nunca una
// implementación paralela. changePassword exige currentPassword (lo
// valida el propio endpoint); changeEmail ya exige sensitiveSessionMiddleware
// (sesión "fresca") por sí solo, pero esta capa AGREGA una
// reautenticación EXPLÍCITA con la contraseña actual (mismo patrón ya
// probado en payment-methods.service.ts::revealPaymentMethodFull) para
// no depender de la semántica exacta de "sesión fresca" de Better Auth,
// que no es configurable ni fácil de verificar desde aquí.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

async function verifyActorPassword(password: string, requestHeaders: Headers): Promise<void> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "currentPassword: Contraseña actual incorrecta.");
  }
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Confirma tu contraseña actual."),
    newPassword: z.string().min(10, "La contraseña debe tener al menos 10 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas nuevas no coinciden.",
    path: ["confirmPassword"],
  });

// Cambia la propia contraseña de un usuario autenticado. Revoca las
// demás sesiones (Better Auth lo hace nativamente vía
// `revokeOtherSessions`) — la sesión actual sigue válida, cualquier
// OTRA sesión abierta en otro dispositivo/navegador queda cerrada.
export async function changeOwnPassword(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ success: true }> {
  const input = parseOrThrow(changePasswordSchema, rawInput);

  if (!checkRateLimit(`change-password:${actor.id}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: requestHeaders,
    });
  } catch {
    // Better Auth valida currentPassword internamente — un mensaje
    // genérico evita distinguir "contraseña actual incorrecta" de
    // cualquier otro fallo interno del proveedor.
    throw new AppError("VALIDATION_ERROR", "currentPassword: Contraseña actual incorrecta.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "USER_PASSWORD_SELF_CHANGED",
    summary: `El usuario cambió su propia contraseña (${actor.email})`,
  });

  try {
    const { subject, html, text } = renderTransactionalEmail({
      subject: "Tu contraseña fue cambiada — Tu Plan Seguro USA",
      bodyHtml: `<p>Tu contraseña del CRM de Tu Plan Seguro USA se cambió correctamente. Todas tus otras sesiones activas se cerraron por seguridad.</p>`,
      bodyText:
        "Tu contraseña del CRM de Tu Plan Seguro USA se cambió correctamente. Todas tus otras sesiones activas se cerraron por seguridad.",
      ignoreNotice: "Si no reconoces este cambio, contacta a un administrador de inmediato.",
    });
    await sendEmail({ to: actor.email, subject, html, text });
  } catch {
    // Mejor esfuerzo — el cambio ya es válido aunque el aviso falle.
  }

  return { success: true };
}

const requestEmailChangeSchema = z.object({
  currentPassword: z.string().min(1, "Confirma tu contraseña actual."),
  // Ver nota de orden en password-recovery.service.ts — normaliza
  // ANTES de validar el formato de email.
  newEmail: z.string().trim().toLowerCase().pipe(z.email("Correo electrónico inválido.")),
});

// Solicita el cambio de correo — el correo NO se aplica todavía (ver
// auth.ts::emailVerification): esto solo dispara el envío de la
// confirmación a la dirección nueva. El aviso a la dirección ANTERIOR
// se envía aquí mismo, de inmediato — nunca se espera a que el usuario
// confirme, porque el objetivo es que el dueño legítimo de la cuenta se
// entere de la SOLICITUD tan pronto ocurre (si no fue él, puede actuar
// antes de que alguien más termine de confirmar el cambio).
export async function requestEmailChange(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ success: true }> {
  const input = parseOrThrow(requestEmailChangeSchema, rawInput);

  if (!checkRateLimit(`change-email:${actor.id}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
  }
  if (input.newEmail === actor.email.toLowerCase()) {
    throw new AppError("VALIDATION_ERROR", "newEmail: Ese ya es tu correo actual.");
  }

  // Reautenticación EXPLÍCITA — ver comentario del encabezado del
  // archivo sobre por qué, además de sensitiveSessionMiddleware.
  await verifyActorPassword(input.currentPassword, requestHeaders);

  const existing = await prisma.user.findUnique({ where: { email: input.newEmail }, select: { id: true } });
  if (existing) {
    // Mismo mensaje "seguro" que createUser — nunca distingue si el
    // correo pertenece a OTRA cuenta activa vs. cualquier otro motivo
    // de rechazo, pero tampoco lo oculta detrás de un mensaje genérico
    // de "algo salió mal": el propio dueño de la cuenta que solicita el
    // cambio ya está autenticado, no es un actor anónimo probando
    // correos ajenos.
    throw new AppError("VALIDATION_ERROR", "newEmail: Ya existe una cuenta con este correo.");
  }

  const oldEmail = actor.email;

  // Se inicia el cambio REAL primero — nunca se audita/notifica una
  // "solicitud" que en realidad no llegó a iniciarse porque Better Auth
  // la rechazó (evita dejar un aviso o un registro de auditoría
  // describiendo algo que no ocurrió).
  try {
    await auth.api.changeEmail({ body: { newEmail: input.newEmail }, headers: requestHeaders });
  } catch {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "No se pudo iniciar el cambio de correo. Intenta de nuevo en unos minutos."
    );
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "USER_EMAIL_CHANGE_REQUESTED",
    summary: `El usuario solicitó cambiar su correo (${oldEmail} → ${input.newEmail})`,
  });

  // Aviso a la dirección ANTERIOR — mejor esfuerzo, nunca revierte la
  // solicitud (ya real en Better Auth) si el envío falla.
  try {
    const { subject, html, text } = renderTransactionalEmail({
      subject: "Se solicitó un cambio de correo en tu cuenta — Tu Plan Seguro USA",
      bodyHtml: `<p>Se solicitó cambiar el correo de tu cuenta del CRM de Tu Plan Seguro USA a <strong>${escapeHtml(input.newEmail)}</strong>. El cambio no se aplicará hasta que se confirme desde esa dirección nueva.</p>`,
      bodyText: `Se solicitó cambiar el correo de tu cuenta del CRM de Tu Plan Seguro USA a ${input.newEmail}. El cambio no se aplicará hasta que se confirme desde esa dirección nueva.`,
      ignoreNotice: "Si no fuiste tú, contacta a un administrador de inmediato — tu correo actual sigue siendo válido mientras tanto.",
    });
    await sendEmail({ to: oldEmail, subject, html, text });
  } catch {
    // Ver comentario arriba.
  }

  return { success: true };
}
