import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { recordAuditEvent } from "@/services/audit.service";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  startTotpEnrollmentSchema,
  confirmTotpEnrollmentSchema,
  regenerateBackupCodesSchema,
  disableTotpSchema,
} from "@/schemas/mfa.schema";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — MFA para ADMIN y operaciones financieras.
//
// Todo lo de aquí es una capa FINA sobre el plugin OFICIAL `twoFactor`
// de Better Auth (ver src/lib/auth.ts) — nunca criptografía propia, ni
// un segundo sistema paralelo de secretos/códigos. Esta capa solo
// agrega: rate limiting propio (Better Auth ya limita /two-factor/* a
// 3 cada 10s de forma nativa — esto añade un límite adicional más
// generoso por usuario, 5/15min, exactamente el número que pide la
// ficha), auditoría de negocio (AuditEvent, distinta del
// failedVerificationCount/lockedUntil nativo), y la regla de negocio
// de "un ADMIN no puede desactivar su propio MFA si es el único ADMIN
// con MFA" (Better Auth no tiene ese concepto — es específico de este
// CRM).
//
// NINGUNA función de aquí recibe el actor vía requireSessionUser()
// normal — los Server Actions que las exponen usan
// requireSessionUserAllowMfaPending() a propósito (ver
// src/lib/authorization.ts): un ADMIN pendiente de configurar MFA
// necesita poder llamar startTotpEnrollment/confirmTotpEnrollment
// exactamente por no cumplir todavía el requisito que esas dos
// funciones existen para satisfacer.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function assertRateLimit(key: string): void {
  if (!checkRateLimit(key, RATE_LIMIT, RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos antes de intentar de nuevo.");
  }
}

// Better Auth expone el error real (contraseña incorrecta, código
// incorrecto, etc.) en `error.message` de forma segura — nunca
// contiene la contraseña ni el código enviados, solo un texto fijo del
// propio framework (ver node_modules/better-auth/dist/plugins/
// two-factor/error-code.mjs y node_modules/better-auth/dist/error/
// codes.mjs) — se puede reenviar tal cual al usuario.
function rethrowAsValidation(error: unknown, fallback: string): never {
  const message = error instanceof Error && error.message ? error.message : fallback;
  throw new AppError("VALIDATION_ERROR", message);
}

export type StartTotpEnrollmentResult = { totpURI: string; backupCodes: string[] };

// Paso 1 de la Sección 2 de la ficha: exige reautenticación, genera el
// secreto (Better Auth) y devuelve la URI otpauth:// (para el QR) y los
// códigos de recuperación EN TEXTO PLANO — la única vez que existen
// así fuera de la base de datos (donde se guardan cifrados). MFA NO
// queda activo todavía (twoFactorEnabled sigue false): falta
// confirmTotpEnrollment con un código real.
export async function startTotpEnrollment(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<StartTotpEnrollmentResult> {
  const input = parseOrThrow(startTotpEnrollmentSchema, rawInput);
  assertRateLimit(`mfa-enroll-start:${actor.id}`);

  let result;
  try {
    result = await auth.api.enableTwoFactor({
      body: { password: input.password, method: "totp" },
      headers: requestHeaders,
    });
  } catch (error) {
    rethrowAsValidation(error, "password: Contraseña incorrecta.");
  }
  if (result.method !== "totp") {
    throw new AppError("VALIDATION_ERROR", "No se pudo iniciar la configuración de MFA.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "MFA_ENROLLMENT_STARTED",
    summary: `El usuario inició la configuración de autenticación en dos pasos (${actor.email})`,
  });

  return { totpURI: result.totpURI, backupCodes: result.backupCodes };
}

// Paso 2: el ÚNICO punto donde MFA pasa a estar realmente activo —
// Better Auth exige un código TOTP válido generado a partir del
// secreto real antes de marcar twoFactorEnabled=true (ver
// node_modules/better-auth/dist/plugins/two-factor/totp/index.mjs).
// Esta es también la PRIMERA verificación TOTP del usuario: Better
// Auth, al confirmar, rota la sesión actual (crea una nueva, borra la
// vieja) y fija la cookie nueva en la respuesta — el plugin
// `nextCookies()` (último en auth.ts) ya aplica eso automáticamente al
// invocar auth.api.* desde un Server Action, así que el navegador
// queda con la sesión correcta sin que esta función tenga que hacer
// nada especial al respecto.
export async function confirmTotpEnrollment(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ success: true }> {
  const input = parseOrThrow(confirmTotpEnrollmentSchema, rawInput);
  assertRateLimit(`mfa-enroll-confirm:${actor.id}`);

  try {
    await auth.api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
  } catch (error) {
    rethrowAsValidation(error, "code: Código incorrecto.");
  }

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "MFA_ENROLLMENT_COMPLETED",
    summary: `El usuario activó la autenticación en dos pasos (${actor.email})`,
  });

  return { success: true };
}

// Sección 5: "Permitir regenerarlos con contraseña + TOTP. Regenerar
// debe invalidar todos los anteriores" — generateBackupCodes de Better
// Auth ya sobrescribe el conjunto completo (nunca añade a los
// anteriores). Revoca las DEMÁS sesiones (nunca la actual — mismo
// criterio ya establecido en account-security.service.ts para cambio
// de contraseña/correo: la sesión que acaba de reautenticarse sigue
// siendo válida, cualquier OTRA queda cerrada).
export async function regenerateBackupCodes(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ backupCodes: string[] }> {
  const input = parseOrThrow(regenerateBackupCodesSchema, rawInput);
  assertRateLimit(`mfa-backup-regenerate:${actor.id}`);

  try {
    await auth.api.verifyPassword({ body: { password: input.password }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "password: Contraseña incorrecta.");
  }
  try {
    await auth.api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "code: Código incorrecto.");
  }

  let result;
  try {
    result = await auth.api.generateBackupCodes({ body: { password: input.password }, headers: requestHeaders });
  } catch (error) {
    rethrowAsValidation(error, "No se pudieron regenerar los códigos de recuperación.");
  }

  await auth.api.revokeOtherSessions({ headers: requestHeaders });

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "MFA_BACKUP_CODES_REGENERATED",
    summary: `El usuario regeneró sus códigos de recuperación (${actor.email})`,
  });

  return { backupCodes: result.backupCodes };
}

// Sección 7: un ADMIN solo puede desactivar su propio MFA en
// autoservicio si existe OTRO ADMIN activo que también tenga MFA
// configurado — garantiza que el CRM nunca quede sin ningún ADMIN
// capaz de operar con MFA. Si no existe, el mensaje dirige al
// procedimiento administrativo local (scripts/mfa-admin-recovery.ts),
// nunca a un atajo dentro de la aplicación.
export async function disableTotp(
  actor: AuthorizedUser,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ success: true }> {
  const input = parseOrThrow(disableTotpSchema, rawInput);
  assertRateLimit(`mfa-disable:${actor.id}`);

  if (actor.role === "ADMIN") {
    const otherAdminsWithMfa = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, twoFactorEnabled: true, id: { not: actor.id } },
    });
    if (otherAdminsWithMfa === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "No puedes desactivar tu MFA: eres el único administrador con autenticación en dos pasos configurada. " +
          "Configura MFA en otro administrador primero, o usa el procedimiento administrativo local de recuperación."
      );
    }
  }

  try {
    await auth.api.verifyPassword({ body: { password: input.password }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "password: Contraseña incorrecta.");
  }
  try {
    await auth.api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "code: Código incorrecto.");
  }

  try {
    // disableTwoFactor (nativo) vuelve a exigir la contraseña por su
    // cuenta — redundante con la verificación de arriba a propósito:
    // esta función nunca confía en un estado "ya verificado" de una
    // llamada anterior para tomar la acción real.
    await auth.api.disableTwoFactor({ body: { password: input.password }, headers: requestHeaders });
  } catch (error) {
    rethrowAsValidation(error, "No se pudo desactivar la autenticación en dos pasos.");
  }

  await auth.api.revokeOtherSessions({ headers: requestHeaders }).catch(() => {
    // disableTwoFactor ya rotó la sesión actual (ver el plugin) — si
    // esto falla no hay nada más que se pueda hacer aquí de forma seria.
  });

  await recordAuditEvent(prisma, {
    actor,
    entityType: "User",
    entityId: actor.id,
    action: "MFA_DISABLED",
    summary: `El usuario desactivó su autenticación en dos pasos (${actor.email})`,
  });

  return { success: true };
}
