import "server-only";
import { PgBoss } from "pg-boss";

// ---------------------------------------------------------------------------
// Cola duradera para los conectores de la Fábrica de leads — Fase 026,
// Preparación para producción. PostgreSQL (pg-boss), sin Redis ni
// ningún servicio nuevo que operar — reutiliza la MISMA base de datos
// ya administrada por este proyecto (ver docs/DECISIONS.md: ningún
// hosting de producción está decidido todavía, así que la cola no
// puede depender de un proveedor específico).
//
// `/api/leads/intake` (formulario propio) NUNCA pasa por aquí — ya es
// durable por sí solo (transacción Prisma + responder después del
// commit). Esta cola es SOLO para conectores que necesitan
// recuperación externa o procesamiento diferido: hoy, Meta (requiere
// una llamada adicional a la Graph API para obtener los datos del
// lead a partir de `leadgen_id`).
//
// Patrón "outbox + sweep", no un `send()` transaccional con el INSERT
// del evento (pg-boss expone un adaptador `fromPrisma` para eso, pero
// su comportamiento dentro de una transacción de aplicación no está
// documentado con suficiente claridad en la documentación oficial
// como para confiar en él sin pruebas exhaustivas — ver
// docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md). En su lugar: (1) el
// webhook escribe `LeadInboundWebhookEvent` en una transacción normal
// y responde; (2) intenta encolar el trabajo de inmediato (mejor
// esfuerzo, reduce la latencia de recogida); (3) un cron de pg-boss
// ("sweep-pending-lead-webhook-events") vuelve a encolar cualquier
// evento PENDING que no se haya recogido — el worst case es un
// retraso acotado por el intervalo del cron, nunca una pérdida.
// ---------------------------------------------------------------------------

export const LEAD_WEBHOOK_EVENT_QUEUE = "lead-webhook-event";
export const LEAD_SWEEP_PENDING_EVENTS_QUEUE = "sweep-pending-lead-webhook-events";
export const LEAD_CLEANUP_RATE_LIMIT_QUEUE = "cleanup-lead-rate-limit-windows";

// Acotados y documentados — ajustables sin migración (son argumentos
// de createQueue, no datos persistidos). retryBackoff exponencial con
// jitter (comportamiento de pg-boss) evita que todos los reintentos de
// una caída masiva (ej. PostgreSQL no disponible unos segundos)
// golpeen la base de datos al mismo tiempo.
export const LEAD_WEBHOOK_EVENT_RETRY_LIMIT = 8;
export const LEAD_WEBHOOK_EVENT_RETRY_DELAY_SECONDS = 15;

let bossInstance: PgBoss | undefined;
let startPromise: Promise<PgBoss> | undefined;

function createBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está configurado — requerido para la cola de leads (pg-boss).");
  }
  // Schema propio ("lead_queue"), separado del schema de la app
  // ("public", administrado por Prisma) — pg-boss administra sus
  // propias tablas internas ahí sin interferir con las migraciones de
  // Prisma ni viceversa.
  return new PgBoss({ connectionString, schema: "lead_queue" });
}

// Idempotente y seguro de llamar varias veces concurrentemente (ej.
// varias rutas API en la misma instancia Next.js) — devuelve siempre
// la MISMA instancia ya iniciada.
export async function getLeadQueue(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (!startPromise) {
    startPromise = (async () => {
      const boss = createBoss();
      await boss.start();
      await boss.createQueue(LEAD_WEBHOOK_EVENT_QUEUE, {
        retryLimit: LEAD_WEBHOOK_EVENT_RETRY_LIMIT,
        retryDelay: LEAD_WEBHOOK_EVENT_RETRY_DELAY_SECONDS,
        retryBackoff: true,
      });
      await boss.createQueue(LEAD_SWEEP_PENDING_EVENTS_QUEUE, {});
      await boss.createQueue(LEAD_CLEANUP_RATE_LIMIT_QUEUE, {});
      bossInstance = boss;
      return boss;
    })();
  }
  return startPromise;
}

// Mejor esfuerzo — nunca lanza. El llamador (ruta de webhook) ya
// escribió el evento de forma duradera ANTES de llamar a esto; si
// encolar falla aquí, el cron de barrido (`sweep-pending-lead-webhook-
// events`) lo recogerá igual. `singletonKey` evita duplicar el
// trabajo si, por lo que sea, se intenta encolar el mismo evento más
// de una vez (reenvío de la plataforma + barrido coincidiendo, etc.).
export async function enqueueLeadWebhookEventJob(eventId: string): Promise<void> {
  try {
    const boss = await getLeadQueue();
    await boss.send(LEAD_WEBHOOK_EVENT_QUEUE, { eventId }, { singletonKey: eventId });
  } catch {
    // Silenciado a propósito — ver comentario de la función. El
    // llamador no debe fallar la respuesta HTTP al webhook por esto.
  }
}

export async function stopLeadQueue(options?: { graceful?: boolean; timeout?: number }): Promise<void> {
  if (!bossInstance) return;
  await bossInstance.stop(options);
  bossInstance = undefined;
  startPromise = undefined;
}
