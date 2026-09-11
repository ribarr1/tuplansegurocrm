import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { parseOrThrow } from "@/services/errors";
import { checkRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — Recuperación de contraseña ("olvidé mi contraseña").
//
// Envuelve el endpoint NATIVO de Better Auth (auth.api.requestPasswordReset,
// ver auth.ts) — nunca reemplaza su lógica de generación/expiración de
// token (eso sigue siendo 100% de Better Auth). Esta capa agrega
// EXACTAMENTE lo que Better Auth NO cubre por sí solo, confirmado leyendo
// su propia implementación (node_modules/better-auth/dist/api/routes/
// password.mjs):
//
//   1. Better Auth envía el correo de reset a CUALQUIER cuenta que exista
//      por email, sin mirar isActive/activatedAt — este módulo filtra
//      cuentas pendientes de activación (activatedAt=null, no tienen
//      contraseña que "restablecer" — deben usar su enlace de invitación)
//      e inactivas ANTES de siquiera llamar al endpoint nativo.
//   2. Better Auth no tiene ningún límite de tasa propio para esta ruta
//      específica más allá de su límite global de auth — se agrega un
//      límite dedicado por correo Y por IP (ver checkRateLimit).
//
// La respuesta hacia el llamador es SIEMPRE la misma
// (`{ status: "sent" }`) sin importar por cuál de las ramas internas
// pasó — igual que ya hace Better Auth para "email no existe" — para
// nunca revelar si una cuenta existe, está pendiente o inactiva.
// ---------------------------------------------------------------------------

const RECOVERY_RATE_LIMIT = 5; // por correo normalizado, cada hora
const RECOVERY_RATE_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_IP_RATE_LIMIT = 20; // más laxo — una IP puede cubrir varias cuentas legítimas (oficina)
const RECOVERY_IP_RATE_WINDOW_MS = 60 * 60 * 1000;

const REDIRECT_TO = "/reset-password";

// Orden importa: normaliza (trim/minúsculas) ANTES de validar el
// formato — z.email().trim() valida el formato con los espacios
// todavía puestos y los rechazaría; z.string().trim().toLowerCase().pipe(z.email())
// normaliza primero, como se espera de un campo de correo pegado desde
// un cliente de correo/navegador que a veces arrastra espacios.
const requestSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo electrónico inválido."));

function clientIpFrom(requestHeaders: Headers): string {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return requestHeaders.get("x-real-ip")?.trim() || "unknown";
}

export type PasswordResetRequestResult = { status: "sent" } | { status: "rate_limited" };

// Nunca lanza por "cuenta no existe/pendiente/inactiva" — SOLO por
// límite de tasa (una señal distinta y explícitamente permitida por la
// ficha: "Proveedor temporalmente no disponible"/estado de "demasiadas
// solicitudes" nunca revela si la cuenta existe, solo que hay que
// esperar).
export async function requestPasswordReset(
  rawEmail: unknown,
  requestHeaders: Headers
): Promise<PasswordResetRequestResult> {
  const email = parseOrThrow(requestSchema, rawEmail);
  const ip = clientIpFrom(requestHeaders);

  const emailAllowed = checkRateLimit(`password-reset:email:${email}`, RECOVERY_RATE_LIMIT, RECOVERY_RATE_WINDOW_MS);
  const ipAllowed = checkRateLimit(`password-reset:ip:${ip}`, RECOVERY_IP_RATE_LIMIT, RECOVERY_IP_RATE_WINDOW_MS);
  if (!emailAllowed || !ipAllowed) {
    return { status: "rate_limited" };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { isActive: true, activatedAt: true },
  });
  const eligible = !!user && user.isActive && user.activatedAt !== null;

  if (eligible) {
    try {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: REDIRECT_TO }, headers: requestHeaders });
    } catch {
      // Nunca se propaga el error del proveedor/Better Auth al
      // llamador — la respuesta siempre es la misma genérica; un fallo
      // real de envío no debe delatar que la cuenta SÍ existe (a
      // diferencia de una cuenta inexistente, que nunca llega a este
      // try/catch).
    }
  } else {
    // Trabajo de costo equivalente para reducir el canal lateral de
    // tiempo entre "cuenta elegible" y "no elegible" — mismo criterio
    // que ya aplica Better Auth internamente para "usuario no
    // encontrado" (genera un id y hace una consulta dummy).
    await prisma.user.findUnique({ where: { email: `__never_matches__${email}` }, select: { id: true } });
  }

  return { status: "sent" };
}
