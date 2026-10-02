import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Rate limiting de la API de recepción de leads — Fase 026,
// Preparación para producción. Compartido entre instancias vía
// PostgreSQL (tabla `LeadRateLimitWindow`, separada por completo de
// las tablas de trabajos del worker — un contador por ventana de
// tiempo no es un estado de procesamiento, nunca se mezclan).
//
// Ventana fija (no sliding window) de 1 minuto, bucket = inicio de
// minuto truncado — todas las instancias calculan el MISMO bucketKey
// para el mismo minuto, así que compiten por la MISMA fila. El
// incremento es una sola sentencia SQL atómica (`INSERT ... ON
// CONFLICT ... DO UPDATE SET count = count + 1 RETURNING count`): dos
// instancias incrementando al mismo tiempo nunca pisan el conteo de
// la otra (la fila queda bloqueada durante la sentencia, PostgreSQL
// serializa el UPDATE concurrente).
//
// Distingue PROTECCIÓN CONTRA ABUSO (este módulo: cuántas solicitudes
// por minuto admite una credencial) de LÍMITES DE PROCESAMIENTO
// (cuántos trabajos procesa el worker a la vez — ver
// scripts/lead-webhook-worker.ts, boss.work(..., {batchSize}) — un
// concepto totalmente distinto, nunca comparten tabla ni función).
// ---------------------------------------------------------------------------
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
// Cuántas ventanas vencidas se conservan antes de poder limpiarlas —
// un margen generoso para poder depurar un pico reciente sin que la
// tabla crezca sin límite. La limpieza real ocurre en un cron de
// pg-boss (ver scripts/lead-webhook-worker.ts), nunca en cada request.
const RETENTION_WINDOWS = 15;

function currentWindowStart(now: number): Date {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
}

export async function checkLeadIntakeRateLimit(
  bucketKey: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const now = Date.now();
  const windowStart = currentWindowStart(now);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "lead_rate_limit_windows" ("id", "bucketKey", "windowStart", "count")
    VALUES (gen_random_uuid(), ${bucketKey}, ${windowStart}, 1)
    ON CONFLICT ("bucketKey", "windowStart")
    DO UPDATE SET "count" = "lead_rate_limit_windows"."count" + 1
    RETURNING "count"
  `;
  const count = rows[0]?.count ?? 1;

  if (count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { allowed: true };
}

// Llamado desde el cron de mantenimiento del worker (nunca desde una
// solicitud de usuario) — elimina ventanas más antiguas que
// RETENTION_WINDOWS minutos. Operación independiente y acotada, nunca
// bloquea la ruta de recepción.
export async function cleanupExpiredRateLimitWindows(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_WINDOWS * WINDOW_MS);
  const result = await prisma.leadRateLimitWindow.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return result.count;
}

export async function _resetLeadIntakeRateLimitForTests(): Promise<void> {
  await prisma.leadRateLimitWindow.deleteMany({});
}
