import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  getLeadQueue,
  stopLeadQueue,
  LEAD_WEBHOOK_EVENT_QUEUE,
  LEAD_SWEEP_PENDING_EVENTS_QUEUE,
  LEAD_CLEANUP_RATE_LIMIT_QUEUE,
  LEAD_WEBHOOK_EVENT_RETRY_LIMIT,
  enqueueLeadWebhookEventJob,
} from "../src/lib/lead-queue";
import {
  getWebhookEventForProcessing,
  markWebhookEventProcessing,
  markWebhookEventProcessed,
  markWebhookEventFailed,
  findStalePendingWebhookEvents,
} from "../src/services/lead-webhook-events.service";
import { cleanupExpiredRateLimitWindows } from "../src/lib/lead-rate-limit";
import { decryptConnectorSecretsObject } from "../src/lib/lead-connector-crypto";
import { mapGoogleLeadToIntakePayload, mapMetaFieldDataToIntakePayload, toExternalId } from "../src/lib/lead-source-mapping";
import { intakeLead } from "../src/services/leads.service";
import { logLeadWorkerEvent } from "../src/lib/lead-observability";
import type { Job } from "pg-boss";
import type { GoogleLeadWebhookPayload, CustomFieldMapping } from "../src/lib/lead-source-mapping";

// ---------------------------------------------------------------------------
// Worker de conectores de leads — Fase 026, Preparación para
// producción (§3, §7A). Proceso Node SEPARADO del servidor web
// (`npm run worker:leads`), igual patrón que
// scripts/policy-lifecycle-job.ts (tsx + dotenv + Prisma), pero de
// vida larga (no termina tras una corrida).
//
// Garantías que pide la ficha, y dónde se cumplen:
//   - Reclamo exclusivo entre varias instancias: automático vía
//     SKIP LOCKED de pg-boss (ninguna instancia extra de este script
//     puede tomar el mismo job que otra ya está procesando).
//   - Recuperación de trabajos abandonados: `expireInSeconds` de la
//     cola (pg-boss reclama un job "active" que superó ese tiempo sin
//     completarse) + el barrido propio de eventos PENDING sin encolar
//     (ver LEAD_SWEEP_PENDING_EVENTS_QUEUE).
//   - Reintentos acotados con espera progresiva: retryLimit/
//     retryDelay/retryBackoff configurados en createQueue (ver
//     lead-queue.ts).
//   - Fallo definitivo + reintento autorizado: LeadInboundWebhookEvent
//     pasa a DEAD_LETTER tras agotar los reintentos; un ADMIN lo
//     reintenta desde /settings/lead-credentials (ver
//     lead-webhook-events.service.ts::retryWebhookEvent).
//   - Apagado ordenado: SIGTERM/SIGINT -> boss.stop({graceful:true}).
//   - Idempotencia procesamiento/creación: delegada a
//     intakeLead()/Lead.originalPayloadSnapshot — si este worker cae
//     DESPUÉS de crear el Lead pero ANTES de marcar el evento
//     PROCESSED, el reintento vuelve a llamar intakeLead con el mismo
//     externalId, que reconoce el lead ya creado sin duplicarlo.
// ---------------------------------------------------------------------------

type WebhookEventJobData = { eventId: string };

// Exportada (no solo interna) para poder probarla directamente, mismo
// patrón ya usado en este proyecto para otros scripts (ver
// scripts/clean-dev-database.test.ts, scripts/create-admin.bootstrap.test.ts).
export async function processWebhookEvent(eventId: string): Promise<void> {
  const startedAt = Date.now();
  const event = await getWebhookEventForProcessing(eventId);
  if (!event) {
    logLeadWorkerEvent({ eventId, result: "EVENT_NOT_FOUND" });
    return;
  }
  // Idempotente ante reintentos del propio pg-boss o del barrido: si
  // ya se marcó PROCESSED en un intento anterior (ej. el worker cayó
  // justo después de marcarlo pero antes de que pg-boss registrara la
  // finalización del job), no se reprocesa.
  if (event.status === "PROCESSED") {
    logLeadWorkerEvent({ eventId, source: event.source, result: "ALREADY_PROCESSED" });
    return;
  }
  if (!event.integrationCredential.isActive) {
    await markWebhookEventFailed(eventId, "La credencial de integración fue revocada.", true);
    logLeadWorkerEvent({ eventId, source: event.source, result: "CREDENTIAL_REVOKED" });
    return;
  }

  await markWebhookEventProcessing(eventId);

  try {
    const customMapping = (event.integrationCredential.customFieldMapping ?? undefined) as
      | CustomFieldMapping
      | undefined;
    let mapped;
    if (event.source === "GOOGLE") {
      mapped = mapGoogleLeadToIntakePayload(event.rawPayload as unknown as GoogleLeadWebhookPayload, customMapping);
    } else if (event.source === "META") {
      const secrets = event.integrationCredential.connectorSecrets
        ? decryptConnectorSecretsObject(event.integrationCredential.connectorSecrets)
        : null;
      if (secrets?.provider !== "META") {
        throw new Error("Credencial Meta sin configuración de conector válida.");
      }
      // Meta envía leadgen_id como NÚMERO en el webhook (docs oficiales)
      // — se normaliza a string; el externalEventId guardado por la
      // ruta es la misma cadena y sirve de respaldo.
      const rawPayload = event.rawPayload as { leadgen_id?: string | number };
      const leadgenId = toExternalId(rawPayload.leadgen_id, "leadgen_id") ?? event.externalEventId;
      // Recuperación de datos cuando el evento solo trae identificadores
      // (§5B) — llamada autenticada a la Graph API. Versión de API: ver
      // docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md (confirmar vigente
      // antes de producción — las versiones de Meta se retiran con el
      // tiempo).
      const graphVersion = process.env.META_GRAPH_API_VERSION || "v21.0";
      const response = await fetch(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(leadgenId)}?fields=created_time,id,ad_id,form_id,field_data&access_token=${encodeURIComponent(secrets.pageAccessToken)}`
      );
      if (!response.ok) {
        throw new Error(`Graph API respondió ${response.status} al recuperar el lead.`);
      }
      const leadData = (await response.json()) as {
        field_data?: { name: string; values: string[] }[];
        created_time?: string;
      };
      mapped = mapMetaFieldDataToIntakePayload(
        leadData.field_data ?? [],
        { leadgenId, createdTime: leadData.created_time },
        customMapping
      );
    } else {
      throw new Error(`Fuente de evento no soportada: ${event.source}`);
    }

    if (!mapped.fullName || !mapped.phone) {
      // Evento legítimo que no cumple los campos mínimos (§5D) — se
      // conserva el fallo para revisión manual, nunca se descarta en
      // silencio. No tiene sentido reintentar (los datos no van a
      // cambiar), pero se deja que agote los reintentos configurados
      // y caiga a DEAD_LETTER de forma visible, igual que cualquier
      // otro fallo — sin tratamiento especial que complique el flujo.
      throw new Error("El evento no incluye nombre y/o teléfono — campos mínimos requeridos.");
    }

    const result = await intakeLead(
      { id: event.integrationCredentialId, source: event.source },
      {
        fullName: mapped.fullName,
        phone: mapped.phone,
        email: mapped.email,
        residenceState: mapped.residenceState,
        productInterest: mapped.productInterest,
        externalId: mapped.externalId ?? event.externalEventId,
        campaignId: mapped.campaignId,
        campaignName: mapped.campaignName,
        originalInquiryAt: mapped.originalInquiryAt,
        consentGiven: mapped.consentGiven ?? null,
        consentText: mapped.consentText,
        consentSource: mapped.consentSource,
        formResponses: mapped.formResponses,
      }
    );

    await markWebhookEventProcessed(eventId, result.lead.id);
    logLeadWorkerEvent({
      eventId,
      source: event.source,
      result: result.duplicate ? "PROCESSED_DUPLICATE" : "PROCESSED_CREATED",
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const isFinal = event.attempts + 1 >= LEAD_WEBHOOK_EVENT_RETRY_LIMIT;
    await markWebhookEventFailed(eventId, message, isFinal);
    logLeadWorkerEvent({
      eventId,
      source: event.source,
      result: isFinal ? "DEAD_LETTER" : "FAILED_WILL_RETRY",
      durationMs: Date.now() - startedAt,
      attempts: event.attempts + 1,
      errorCategory: message.slice(0, 120),
    });
    throw error; // pg-boss también registra el fallo y aplica su propio retryDelay/backoff.
  }
}

async function main() {
  const boss = await getLeadQueue();

  await boss.work<WebhookEventJobData>(LEAD_WEBHOOK_EVENT_QUEUE, { batchSize: 1 }, async (jobs: Job<WebhookEventJobData>[]) => {
    for (const job of jobs) {
      await processWebhookEvent(job.data.eventId);
    }
  });

  // Barrido: eventos PENDING que no se recogieron (el `send` desde la
  // ruta del webhook fue mejor esfuerzo) — vuelve a encolarlos.
  // `singletonKey` en enqueueLeadWebhookEventJob evita duplicar el
  // trabajo si ya estaba encolado.
  await boss.schedule(LEAD_SWEEP_PENDING_EVENTS_QUEUE, "*/1 * * * *", {});
  await boss.work(LEAD_SWEEP_PENDING_EVENTS_QUEUE, {}, async () => {
    const stale = await findStalePendingWebhookEvents(60_000);
    for (const row of stale) {
      await enqueueLeadWebhookEventJob(row.id);
    }
    if (stale.length > 0) {
      logLeadWorkerEvent({ result: "SWEPT_PENDING_EVENTS", attempts: stale.length });
    }
  });

  // Limpieza de ventanas de rate limiting vencidas — tabla totalmente
  // separada de los trabajos (§4 del usuario).
  await boss.schedule(LEAD_CLEANUP_RATE_LIMIT_QUEUE, "*/5 * * * *", {});
  await boss.work(LEAD_CLEANUP_RATE_LIMIT_QUEUE, {}, async () => {
    const deleted = await cleanupExpiredRateLimitWindows();
    if (deleted > 0) {
      logLeadWorkerEvent({ result: "CLEANED_RATE_LIMIT_WINDOWS", attempts: deleted });
    }
  });

  console.log("[lead-webhook-worker] Worker iniciado — escuchando trabajos.");

  // Apagado ordenado (§3): deja de tomar trabajos nuevos y espera a
  // que los que están en curso terminen, dentro del tiempo límite.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[lead-webhook-worker] ${signal} recibido — apagado ordenado...`);
    try {
      await stopLeadQueue({ graceful: true, timeout: 30_000 });
      console.log("[lead-webhook-worker] Apagado completado.");
      process.exit(0);
    } catch (error) {
      console.error("[lead-webhook-worker] Error durante el apagado:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Guarda de punto de entrada (equivalente ESM de `require.main ===
// module`) — permite `import { processWebhookEvent } from
// "../scripts/lead-webhook-worker"` desde un test SIN disparar
// main() como efecto secundario (que arrancaría pg-boss y un loop
// de vida larga que nunca resuelve, colgando el proceso de pruebas).
// Al ejecutarse como script (`npm run worker:leads`), process.argv[1]
// es este mismo archivo y la condición se cumple normalmente.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("[lead-webhook-worker] Error fatal al iniciar:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
