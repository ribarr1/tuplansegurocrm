import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Redirección optimista: solo verifica si existe una cookie de sesión
// con forma válida (Proxy en Next.js 16 corre en runtime Node.js por
// defecto, pero igualmente no debe hacer queries pesadas a la base de
// datos en cada request). La verificación real (sesión válida +
// User.isActive) ocurre en requireUser(), dentro del layout del área
// protegida ((app)/layout.tsx), en cada request.
const PROTECTED_PREFIXES = ["/dashboard", "/contacts"];

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );
  if (!isProtected) return NextResponse.next();

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/contacts/:path*"],
};
