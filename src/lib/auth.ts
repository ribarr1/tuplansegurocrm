import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
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
      await sendEmail({
        to: user.email,
        subject: "Restablece tu contraseña — Tu Plan Seguro USA",
        text: `Hola,\n\nRecibimos una solicitud para restablecer tu contraseña. Si fuiste tú, usa este enlace (válido por 1 hora, un solo uso):\n\n${url}\n\nSi no lo solicitaste, ignora este correo — tu contraseña actual sigue funcionando.`,
        html: `<p>Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, usa este enlace (válido por 1 hora, un solo uso):</p><p><a href="${url}">${url}</a></p><p>Si no lo solicitaste, ignora este correo — tu contraseña actual sigue funcionando.</p>`,
      });
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
