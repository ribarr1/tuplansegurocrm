import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { findActiveCredentialBySource, getDecryptedConnectorSecrets } from "@/services/lead-credentials.service";
import { recordInboundWebhookEvent, enqueueInboundWebhookEvent } from "@/services/lead-webhook-events.service";
import { checkLeadIntakeRateLimit } from "@/lib/lead-rate-limit";
import { logLeadWebhookEvent } from "@/lib/lead-observability";
import { timingSafeEqualStrings, verifyMetaSignature, quoteLargeIntegerIds, toExternalId } from "@/lib/lead-source-mapping";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Webhook de Meta — Lead Ads (Fase 026, Preparación para producción,
// §5B). Dos mecanismos oficiales distintos en la MISMA ruta, como
// exige la plataforma — ver docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md:
//
//   GET  — handshake de verificación del callback (una sola vez, al
//          configurar el webhook en el panel de la app de Meta):
//          responde `hub.challenge` si `hub.verify_token` coincide.
//   POST — notificación real de evento `leadgen`. Autenticidad
//          verificada con el header `X-Hub-Signature-256` (HMAC-SHA256
//          del cuerpo crudo con el App Secret) — NUNCA se confía en el
//          payload sin esta verificación.
//
// El payload del webhook NUNCA trae los datos del lead — solo
// `leadgen_id`; los datos reales se recuperan después vía la Graph API
// (ver scripts/lead-webhook-worker.ts), por eso este conector SÍ
// necesita la cola (a diferencia de Google).
//
// Meta reintenta "inmediatamente, luego unas pocas veces más con
// frecuencia decreciente durante 36 horas" si no recibe 200 a tiempo
// — por eso la ÚNICA operación antes de responder es la escritura
// durable del evento (nunca la llamada a la Graph API, que puede
// tardar y fallar por separado, ver el worker).
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Solicitud de verificación inválida." }, { status: 400 });
  }

  // El verify_token es el MISMO para todas las credenciales META
  // activas en la práctica (se define una vez en el panel de Meta al
  // configurar el webhook de la app) — se acepta si coincide con
  // AL MENOS una credencial META configurada.
  const candidates = await findActiveCredentialBySource("META");
  for (const candidate of candidates) {
    const secrets = await getDecryptedConnectorSecrets(candidate.id);
    if (secrets?.provider === "META" && timingSafeEqualStrings(token, secrets.verifyToken)) {
      return new NextResponse(challenge, { status: 200 });
    }
  }
  return NextResponse.json({ error: "verify_token inválido." }, { status: 403 });
}

type MetaWebhookBody = {
  object?: string;
  entry?: {
    id?: string | number; // page_id
    // Meta envía estos ids como NÚMERO (docs oficiales) — ver toExternalId.
    changes?: { field?: string; value?: { leadgen_id?: string | number; page_id?: string | number; form_id?: string | number; created_time?: number; ad_id?: string | number; adgroup_id?: string | number } }[];
  }[];
};

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  const rawBody = await request.text();

  // La firma se valida contra TODAS las credenciales META activas
  // (cada una tiene su propio App Secret) — se procesa con la primera
  // que la valide. Varias apps/páginas de Meta configuradas al mismo
  // tiempo es el caso normal de "cada integración con su propia
  // configuración independiente y revocable" (§5D).
  const candidates = await findActiveCredentialBySource("META");
  let matchedCredentialId: string | null = null;
  let matchedPageId: string | null = null;
  for (const candidate of candidates) {
    const secrets = await getDecryptedConnectorSecrets(candidate.id);
    if (secrets?.provider !== "META") continue;
    if (verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), secrets.appSecret)) {
      matchedCredentialId = candidate.id;
      matchedPageId = secrets.pageId;
      break;
    }
  }

  if (!matchedCredentialId) {
    logLeadWebhookEvent({ correlationId, source: "META", result: "INVALID_SIGNATURE", durationMs: Date.now() - startedAt });
    // Meta reintenta según su propia política — un 403 por firma
    // inválida nunca se arregla reintentando el MISMO cuerpo, pero
    // responder distinto no cambia su comportamiento de reintento
    // documentado; se devuelve 403 de todas formas, nunca 200.
    return NextResponse.json({ error: "Firma inválida." }, { status: 403 });
  }

  let rateLimit: { allowed: boolean; retryAfterSeconds?: number };
  try {
    rateLimit = await checkLeadIntakeRateLimit(`meta:${matchedCredentialId}`);
  } catch {
    return NextResponse.json({ error: "Servicio temporalmente no disponible." }, { status: 503 });
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  let body: MetaWebhookBody;
  try {
    // La firma ya se verificó contra el cuerpo CRUDO; citar los ids
    // grandes solo afecta al parseo posterior (ver quoteLargeIntegerIds).
    const parsed: unknown = JSON.parse(quoteLargeIntegerIds(rawBody));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    }
    body = parsed as MetaWebhookBody;
  } catch {
    logLeadWebhookEvent({ correlationId, source: "META", result: "INVALID_PAYLOAD", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const leadgenChanges =
    body.entry?.flatMap((e) => (e.changes ?? []).filter((c) => c.field === "leadgen" && c.value?.leadgen_id)) ?? [];

  if (leadgenChanges.length === 0) {
    // Notificación de un campo/evento que no nos interesa (la app
    // podría estar suscrita a más de un campo) — se responde 200 de
    // todas formas (Meta exige 200 para CUALQUIER notificación
    // reconocida, nunca solo para las que procesamos).
    return new NextResponse(null, { status: 200 });
  }

  // Restricción a páginas/formularios configurados (§5B): solo se
  // acepta si el page_id del evento coincide con el configurado para
  // esta credencial — un evento de OTRA página que, por lo que sea,
  // llegara a este endpoint (app suscrita a varias páginas) nunca se
  // procesa bajo una credencial ajena.
  const acceptedEventIds: string[] = [];
  for (const change of leadgenChanges) {
    // page_id/leadgen_id llegan como número: se comparan y guardan
    // como string (antes, `number !== string` descartaba EN SILENCIO
    // todo evento con page_id configurado).
    let pageId: string | undefined;
    let leadgenId: string | undefined;
    try {
      pageId = toExternalId(change.value?.page_id, "page_id");
      leadgenId = toExternalId(change.value?.leadgen_id, "leadgen_id");
    } catch {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }
    if (matchedPageId && pageId && pageId !== matchedPageId.trim()) continue;
    if (!leadgenId) continue;

    try {
      const { event } = await recordInboundWebhookEvent({
        source: "META",
        integrationCredentialId: matchedCredentialId,
        externalEventId: leadgenId,
        rawPayload: change.value as unknown as Prisma.InputJsonValue,
      });
      await enqueueInboundWebhookEvent(event.id);
      acceptedEventIds.push(event.id);
    } catch {
      logLeadWebhookEvent({
        correlationId,
        source: "META",
        eventId: leadgenId,
        result: "STORAGE_ERROR",
        durationMs: Date.now() - startedAt,
      });
      // Si falla la escritura durable de ALGÚN evento del lote, se
      // responde con error para que Meta reintente TODO el payload —
      // nunca se confirma éxito parcial silenciosamente.
      return NextResponse.json({ error: "No se pudo procesar el evento. Reintenta." }, { status: 500 });
    }
  }

  logLeadWebhookEvent({
    correlationId,
    source: "META",
    result: "ACCEPTED",
    durationMs: Date.now() - startedAt,
  });
  return new NextResponse(null, { status: 200 });
}
