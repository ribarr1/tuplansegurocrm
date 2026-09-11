import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/services/errors";
import type { UserRole } from "@/generated/prisma/client";

export type AuthorizedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  // PREPRODUCCIÓN — MFA. Reflejo directo de User.twoFactorEnabled
  // (nunca de la sesión cacheada de Better Auth — mismo criterio que
  // el resto de este archivo). Sirve para que la UI sepa si mostrar
  // "activar" o "administrar" MFA; la EXIGENCIA real para ADMIN vive
  // en assertMfaCompliant, más abajo.
  twoFactorEnabled: boolean;
};

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  twoFactorEnabled: true,
} as const;

// PREPRODUCCIÓN — MFA (Sección 3 de la ficha). Todo ADMIN debe tener
// MFA configurado antes de poder usar el CRM o ejecutar cualquier
// acción — "mientras no complete MFA, no puede entrar al CRM ni
// ejecutar acciones administrativas... la validación debe existir
// server-side". Se aplica dentro de requireUser/requireSessionUser
// (usadas por TODAS las páginas y Server Actions de la aplicación —
// ver comentario de cada una) para que ningún Server Action pueda
// saltarse esto manipulando la ruta directamente. Las únicas
// excepciones son las funciones *AllowMfaPending de abajo, usadas
// exclusivamente por el propio flujo de enrollment de MFA (que un
// ADMIN pendiente SÍ debe poder ejecutar).
function assertMfaCompliant(user: AuthorizedUser): void {
  if (user.role === "ADMIN" && !user.twoFactorEnabled) {
    throw new AppError(
      "MFA_REQUIRED",
      "Los administradores deben configurar la autenticación en dos pasos antes de continuar."
    );
  }
}

// requestHeaders es opcional y existe solo para poder probar esta capa
// con Vitest usando una sesión real (creada con auth.api.signInEmail en
// el propio test) sin depender del runtime de request de Next.js. En
// producción siempre se omite y se usa next/headers().
type RequestHeaders = Headers;

// Nunca confía en los datos de sesión cacheados por Better Auth: siempre
// vuelve a consultar Prisma para reflejar role/isActive en tiempo real.
// Esto es lo que garantiza que desactivar un User bloquee su siguiente
// petición protegida, aunque su cookie de sesión siga siendo válida.
export async function getSessionUser(
  requestHeaders?: RequestHeaders
): Promise<AuthorizedUser | null> {
  const hdrs = requestHeaders ?? (await headers());
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: userSelect,
  });
  if (!user || !user.isActive) return null;

  return user;
}

// --- Para Server Components / Server Actions que renderizan una página ---
// Redirigen en vez de lanzar: apropiadas solo en contexto de render.

export async function requireUser(): Promise<AuthorizedUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN" && !user.twoFactorEnabled) redirect("/mfa/setup");
  return user;
}

// Usada ÚNICAMENTE por las páginas del propio flujo de enrollment de
// MFA (/mfa/setup) — un ADMIN pendiente debe poder VER esa página sin
// quedar atrapado en un redirect hacia sí misma. Nunca usar esto en
// ninguna otra página: es la única puerta que un ADMIN sin MFA puede
// atravesar (ver assertMfaCompliant más arriba).
export async function requireUserAllowMfaPending(): Promise<AuthorizedUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthorizedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

// --- Para la capa de servicios (src/services/*) ---
// Lanzan AppError en vez de redirigir: el llamador (Server Action /
// Route Handler) decide cómo mostrar el error. Este es el único lugar
// de la aplicación donde se construye un AuthorizedUser legítimo para
// pasar a un servicio — un servicio nunca debe recibir un "actor"
// construido a mano a partir de datos enviados por el cliente.
export async function requireSessionUser(
  requestHeaders?: RequestHeaders
): Promise<AuthorizedUser> {
  const user = await getSessionUser(requestHeaders);
  if (!user) throw new AppError("UNAUTHORIZED", "No autenticado.");
  assertMfaCompliant(user);
  return user;
}

// Ver requireUserAllowMfaPending — misma excepción, para los Server
// Actions que respaldan /mfa/setup (mfa.service.ts). Nunca usar en
// ningún otro Server Action.
export async function requireSessionUserAllowMfaPending(
  requestHeaders?: RequestHeaders
): Promise<AuthorizedUser> {
  const user = await getSessionUser(requestHeaders);
  if (!user) throw new AppError("UNAUTHORIZED", "No autenticado.");
  return user;
}

export async function requireSessionRole(
  roles: UserRole[],
  requestHeaders?: RequestHeaders
): Promise<AuthorizedUser> {
  const user = await requireSessionUser(requestHeaders);
  if (!roles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "No autorizado para esta operación.");
  }
  return user;
}
