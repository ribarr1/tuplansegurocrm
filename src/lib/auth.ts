import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { renderTransactionalEmail, escapeHtml } from "@/lib/email-templates";
import { recordAuditEvent } from "@/services/audit.service";

// Autenticación: email + password con sesiones respaldadas por base de
// datos (no JWT-only), para poder revocar acceso en tiempo real cuando
// User.isActive pasa a false. Tablas técnicas (Session, Account,
// Verification) están separadas del modelo de negocio (User).
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Nadie puede autorregistrarse — este es un CRM interno con acceso
    // a datos reales de clientes. Los usuarios los crea un ADMIN desde
    // Configuración → Usuarios (users.service.ts::createUser), que
    // construye el User + Account directamente (mismo hash de
    // contraseña que usa Better Auth) sin pasar por esta ruta pública,
    // que queda bloqueada incluso para llamadas internas.
    disableSignUp: true,
    // CORRECCIÓN (recuperación de contraseña) — "Olvidé mi contraseña"
    // para cuentas YA activas usa el flujo NATIVO de Better Auth
    // (nunca un sistema paralelo): un solo POST a /request-password-reset
    // ya responde con el mismo mensaje genérico exista o no la cuenta
    // (con generación de token simulada para mitigar timing attacks —
    // ver node_modules/better-auth/dist/api/routes/password.mjs), y
    // /reset-password consume el token UNA sola vez
    // (consumeVerificationValue) antes de aceptar la nueva contraseña.
    // Expiración corta (1 hora, mucho menor que las 24h del enlace de
    // invitación inicial — ver user-invitations.service.ts, que sí
    // necesita esa ventana más larga y un ciclo de vida administrable
    // por el ADMIN que este endpoint nativo no expone).
    resetPasswordTokenExpiresIn: 60 * 60,
    // Cerrar las demás sesiones tras cambiar la contraseña — ítem
    // explícito de la corrección ("permitir cerrar las demás sesiones
    // después del cambio").
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const { subject, html, text } = renderTransactionalEmail({
        subject: "Restablece tu contraseña — Tu Plan Seguro USA",
        bodyHtml: "<p>Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente botón (válido por 1 hora, un solo uso):</p>",
        bodyText: "Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente enlace (válido por 1 hora, un solo uso):",
        ctaLabel: "Restablecer mi contraseña",
        ctaUrl: url,
        ignoreNotice: "Si no lo solicitaste, ignora este correo — tu contraseña actual sigue funcionando.",
      });
      await sendEmail({ to: user.email, subject, html, text });
    },
    // Auditoría del cambio — nunca el token ni la contraseña, solo el
    // hecho de que el propio usuario restableció su contraseña
    // (distinto de USER_PASSWORD_RESET, que es un ADMIN forzando la de
    // otro usuario, ver users.service.ts::resetUserPassword).
    onPasswordReset: async ({ user }) => {
      await recordAuditEvent(prisma, {
        actor: null,
        entityType: "User",
        entityId: user.id,
        action: "USER_PASSWORD_SELF_RESET",
        summary: `El usuario restableció su propia contraseña (${user.email})`,
      });
    },
  },
  // role/isActive son campos de negocio ya existentes en User; se
  // declaran aquí solo para que Better Auth los conozca al leer la
  // sesión. No se gestionan por el flujo de signup (input: false) — los
  // administra la aplicación directamente.
  user: {
    additionalFields: {
      role: {
        type: "string",
        input: false,
      },
      isActive: {
        type: "boolean",
        input: false,
      },
    },
    // PREPRODUCCIÓN — cambio de correo AUTOSERVICIO para un usuario ya
    // autenticado (Sección 6 de la ficha). Usa el endpoint NATIVO
    // /change-email (ya protegido por sensitiveSessionMiddleware —
    // Better Auth exige una sesión "fresca" antes de aceptar esta
    // llamada, que es exactamente la reautenticación que pide la
    // ficha). `updateEmailWithoutVerification` se deja SIN configurar
    // (false) a propósito: como `emailVerified` en este proyecto nunca
    // se marca true (no hay verificación de correo al crear/invitar),
    // dejarlo así fuerza SIEMPRE el camino de "enviar verificación al
    // correo NUEVO antes de aplicar el cambio" (ver emailVerification
    // más abajo) — nunca un cambio inmediato sin confirmación.
    changeEmail: {
      enabled: true,
    },
  },
  // PREPRODUCCIÓN — el correo NUEVO debe confirmarse antes de que el
  // cambio de correo se aplique de verdad (Sección 6: "Enviar
  // confirmación al correo nuevo antes de completar el cambio"). Este
  // callback es el único disponible en la versión instalada para ese
  // propósito (ver node_modules/better-auth/dist/api/routes/
  // update-user.mjs::changeEmail) — Better Auth arma la URL de
  // verificación (JWT firmado con BETTER_AUTH_SECRET, de un solo uso,
  // con expiración) y solo delega el ENVÍO del correo aquí.
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, html, text } = renderTransactionalEmail({
        subject: "Confirma tu nuevo correo — Tu Plan Seguro USA",
        bodyHtml: `<p>Recibimos una solicitud para cambiar el correo de tu cuenta en el CRM de Tu Plan Seguro USA a esta dirección. Confirma con el siguiente botón (un solo uso):</p>`,
        bodyText: "Recibimos una solicitud para cambiar el correo de tu cuenta en el CRM de Tu Plan Seguro USA a esta dirección. Confirma con el siguiente enlace (un solo uso):",
        ctaLabel: "Confirmar este correo",
        ctaUrl: url,
        ignoreNotice: "Si no solicitaste este cambio, ignora este correo — tu dirección actual sigue siendo la misma.",
      });
      await sendEmail({ to: user.email, subject, html, text });
    },
    // Se dispara justo DESPUÉS de que el correo nuevo ya quedó
    // aplicado en User.email — audita el hecho consumado (nunca antes,
    // cuando todavía podría no completarse) y avisa a la dirección
    // NUEVA que el cambio ya es efectivo. El aviso al correo ANTERIOR
    // se envía en el momento de la SOLICITUD, no aquí — ver
    // account-security.service.ts::requestEmailChange (ya se conoce en
    // ese momento sin depender de este callback).
    afterEmailVerification: async (updatedUser) => {
      await recordAuditEvent(prisma, {
        actor: null,
        entityType: "User",
        entityId: updatedUser.id,
        action: "USER_EMAIL_CHANGED",
        summary: `El usuario confirmó su cambio de correo (${updatedUser.email})`,
      });
      const { subject, html, text } = renderTransactionalEmail({
        subject: "Tu correo fue actualizado — Tu Plan Seguro USA",
        bodyHtml: `<p>El correo de tu cuenta en el CRM de Tu Plan Seguro USA se actualizó a <strong>${escapeHtml(updatedUser.email)}</strong>.</p>`,
        bodyText: `El correo de tu cuenta en el CRM de Tu Plan Seguro USA se actualizó a ${updatedUser.email}.`,
        ignoreNotice: "Si no reconoces este cambio, contacta a un administrador de inmediato.",
      });
      try {
        await sendEmail({ to: updatedUser.email, subject, html, text });
      } catch {
        // Mejor esfuerzo — el cambio de correo ya es un hecho consumado
        // y válido aunque este aviso de cortesía falle.
      }
    },
  },
  // Genera UUID (no el id aleatorio propio de Better Auth), consistente
  // con el resto del esquema (ver docs/DECISIONS.md — Identificadores).
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  // Rate limiting de intentos de login. Por defecto Better Auth solo lo
  // activa en producción; lo forzamos también en desarrollo para
  // verificarlo ahora. Storage "memory": suficiente para un solo
  // proceso/instancia (nuestro caso actual). En producción con más de
  // una instancia del servidor, cambiar a "database" o
  // "secondary-storage" (ej. Redis) — documentado en docs/SECURITY.md.
  rateLimit: {
    enabled: true,
    storage: "memory",
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // nextCookies debe ser el último plugin: gestiona automáticamente las
  // cookies de sesión al invocar auth.api.* desde Server Actions.
  plugins: [nextCookies()],
});
