import "server-only";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — Correos, invitaciones y recuperación de acceso.
//
// Punto ÚNICO de lectura/validación de las variables de entorno
// relacionadas con URLs públicas y correo — antes de esta fase cada
// consumidor (email.ts, user-invitations.service.ts, auth.ts) leía
// `process.env.X` por su cuenta, sin validar nada al arrancar. Este
// módulo se importa desde los puntos de entrada reales (auth.ts,
// email.ts) para que un problema de configuración falle pronto y con
// un mensaje claro, en vez de fallar tarde (a mitad de una invitación)
// con un error genérico.
//
// APP_URL es la URL pública CANÓNICA para construir cualquier enlace
// que un usuario recibe por correo (activación, verificación de correo
// nuevo) — nunca se adivina desde el request (Host header falsificable)
// ni se concatena a mano en cada lugar. Si no está configurada, se usa
// BETTER_AUTH_URL como respaldo (mismo valor en la inmensa mayoría de
// despliegues de una sola app) para no romper instalaciones existentes
// que ya configuraron solo esa — pero se recomienda fijar APP_URL
// explícitamente.
//
// NUNCA se imprime el valor de ninguna variable sensible (RESEND_API_KEY,
// BETTER_AUTH_SECRET, PII_ENCRYPTION_KEY) en ningún mensaje de error de
// este módulo — solo se nombra la variable que falta.
// ---------------------------------------------------------------------------

function readAppUrl(): string {
  const raw = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").trim();
  if (!raw) {
    throw new Error(
      "APP_URL (o, como respaldo, BETTER_AUTH_URL) no está configurada — requerida para construir enlaces en correos."
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("APP_URL no es una URL válida.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_URL debe usar HTTPS en producción.");
  }
  // Sin barra final — cada caller compone rutas con `new URL(path, APP_URL)`.
  return raw.replace(/\/+$/, "");
}

let cachedAppUrl: string | undefined;

// Perezoso (no se evalúa al importar el módulo) para que los tests que
// nunca necesitan APP_URL no fallen solo por no tenerla configurada, y
// para que el error real aparezca en el momento de uso — mismo criterio
// ya establecido en pii-crypto-core.ts/financial-crypto.ts.
export function getAppUrl(): string {
  if (!cachedAppUrl) cachedAppUrl = readAppUrl();
  return cachedAppUrl;
}

export function buildAppUrl(path: string, searchParams?: Record<string, string>): string {
  const url = new URL(path, `${getAppUrl()}/`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value);
  }
  return url.toString();
}

// Validación agrupada de correo — llamada desde email.ts antes de
// intentar el primer envío real (nunca al importar el módulo, mismo
// criterio de "fallar al usar, no al cargar"). Nunca valida
// RESEND_API_KEY/EMAIL_FROM aquí mismo con doble mensaje: email.ts ya
// los valida con su propio error claro — esta función solo cubre
// APP_URL, que email.ts NO necesita pero sí los callers que construyen
// enlaces (user-invitations.service.ts, auth.ts).
export function assertEmailLinksConfigured(): void {
  getAppUrl();
}

export function _resetEnvCacheForTests(): void {
  cachedAppUrl = undefined;
}
