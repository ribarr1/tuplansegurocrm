import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma/client";

export type AuthorizedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

// Nunca confía en los datos de sesión cacheados por Better Auth: siempre
// vuelve a consultar Prisma para reflejar role/isActive en tiempo real.
// Esto es lo que garantiza que desactivar un User bloquee su siguiente
// petición protegida, aunque su cookie de sesión siga siendo válida.
export async function getSessionUser(): Promise<AuthorizedUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return user;
}

// Para Server Components / Server Actions: redirige a /login si no hay
// sesión válida o el usuario está desactivado.
export async function requireUser(): Promise<AuthorizedUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// Para Server Components / Server Actions: además de requireUser(),
// exige que el rol esté en la lista permitida.
export async function requireRole(...roles: UserRole[]): Promise<AuthorizedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
