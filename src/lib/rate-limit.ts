import "server-only";

// ---------------------------------------------------------------------------
// CORRECCIÓN (activación de usuarios / recuperación de contraseña) —
// limitador de tasa mínimo, en memoria (ventana fija). No existía
// ningún limitador de tasa propio en el proyecto (Better Auth trae el
// suyo, `rateLimit: { enabled: true, storage: "memory" }` en auth.ts,
// pero solo cubre SUS propias rutas — nunca las acciones nuevas de
// este módulo: reenviar invitación, activar cuenta). `storage:
// "memory"` es coherente con el resto del proyecto (una sola instancia
// en el VPS, sin Redis) — nunca sirve para un despliegue multi-instancia,
// documentado explícitamente.
// ---------------------------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

// Limpieza perezosa: nunca un temporizador de fondo (innecesario para
// un volumen tan bajo de claves — invitaciones/activaciones de cuentas
// internas, no tráfico público de alto volumen).
function sweepExpired(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// Devuelve true si la operación identificada por `key` está permitida
// ahora mismo (y consume una unidad de la ventana actual); false si se
// excedió el límite y debe rechazarse.
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweepExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

// Solo para pruebas — nunca se llama desde código de producción.
export function resetRateLimitForTests(): void {
  buckets.clear();
}
