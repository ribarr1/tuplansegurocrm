import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

// Autenticación: email + password con sesiones respaldadas por base de
// datos (no JWT-only), para poder revocar acceso en tiempo real cuando
// User.isActive pasa a false. Tablas técnicas (Session, Account,
// Verification) están separadas del modelo de negocio (User).
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
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
