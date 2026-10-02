import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { findActiveCredentialBySource, getDecryptedConnectorSecrets } from "@/services/lead-credentials.service";
import { recordInboundWebhookEvent, enqueueInboundWebhookEvent } from "@/services/lead-webhook-events.service";
import { verifyGoogleWebhookKey, type GoogleLeadWebhookPayload } from "@/lib/lead-source-mapping";
import { checkLeadIntakeRateLimit } from "@/lib/lead-rate-limit";
import { logLeadWebhookEvent } from "@/lib/lead-observability";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Webhook de Google Ads — Lead Form Extensions (Fase 026, Preparación
// para producción, §5A). Mecanismo oficial soportado por Google:
// entrega por POST a una URL configurada en el formulario, con un
// `google_key` compartido para verificar autenticidad (en el CUERPO,
// no en un header). Fuente, fecha de revisión y versión: ver
// docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md.
//
// NUNCA asume el JSON normalizado propio ni el header Bearer de
// `/api/leads/intake` — este es un contrato DISTINTO, el que Google
// realmente envía.
//
// Respuesta esperada por Google (documentado): 200 con `{}` = éxito;
// 4XX con `{"message": "..."}` = no reintentable; 5XX = reintentable.
// Deduplicación por `lead_id` — ya resuelta por
// LeadInboundWebhookEvent.@@unique([source, integrationCredentialId,
// externalEventId]).
//
// No requiere cola para procesamiento diferido (a diferencia de Meta):
// el payload YA trae todos los datos del lead, no hace falta una
// llamada adicional a ninguna API para completarlo — se guarda
// (durable) y se encola solo para mantener un único camino de
// procesamiento con Meta y poder aplicar reintentos/observabilidad de
// forma uniforme, nunca porque sea estrictamente necesario aquí.
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  const startedAt = Date.now();

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "Payload demasiado grande." }, { status: 413 });
  }

  let body: GoogleLeadWebhookPayload;
  try {
    body = JSON.parse(rawBody) as GoogleLeadWebhookPayload;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  if (!body.lead_id || !body.google_key) {
    logLeadWebhookEvent({ correlationId, source: "GOOGLE", result: "INVALID_PAYLOAD", durationMs: Date.now() - startedAt });
    return NextResponse.json({ message: "Faltan campos requeridos (lead_id, google_key)." }, { status: 400 });
  }

  // No hay un header que identifique DE ANTEMANO cuál credencial envió
  // esto (a diferencia de /api/leads/intake con su Bearer) — Google
  // entrega el `google_key` en el cuerpo; se busca entre las
  // credenciales GOOGLE activas cuál tiene ESA clave configurada. Con
  // pocas integraciones por agencia esto es aceptable; documentado
  // como limitación si se configuraran muchas cuentas de Google Ads.
  const candidates = await findActiveCredentialBySource("GOOGLE");
  let matchedCredentialId: string | null = null;
  for (const candidate of candidates) {
    if (!candidate.connectorSecrets) continue;
    const secrets = await getDecryptedConnectorSecrets(candidate.id);
    if (secrets?.provider === "GOOGLE" && verifyGoogleWebhookKey(body.google_key, secrets.verificationKey)) {
      matchedCredentialId = candidate.id;
      break;
    }
  }

  if (!matchedCredentialId) {
    logLeadWebhookEvent({ correlationId, source: "GOOGLE", result: "UNAUTHORIZED", durationMs: Date.now() - startedAt });
    // 4XX = no reintentable (documentado) — una clave inválida nunca
    // se arregla reintentando.
    return NextResponse.json({ message: "google_key inválida." }, { status: 401 });
  }

  let rateLimit: { allowed: boolean; retryAfterSeconds?: number };
  try {
    rateLimit = await checkLeadIntakeRateLimit(`google:${matchedCredentialId}`);
  } catch {
    // 5XX = Google reintentará — nunca se devuelve éxito sin procesar.
    return NextResponse.json({ message: "Servicio temporalmente no disponible." }, { status: 503 });
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({ message: "Demasiadas solicitudes." }, { status: 429 });
  }

  try {
    const { event } = await recordInboundWebhookEvent({
      source: "GOOGLE",
      integrationCredentialId: matchedCredentialId,
      externalEventId: body.lead_id,
      rawPayload: body as unknown as Prisma.InputJsonValue,
    });
    await enqueueInboundWebhookEvent(event.id);
    logLeadWebhookEvent({
      correlationId,
      source: "GOOGLE",
      eventId: event.id,
      result: "ACCEPTED",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({}, { status: 200 });
  } catch {
    logLeadWebhookEvent({ correlationId, source: "GOOGLE", result: "STORAGE_ERROR", durationMs: Date.now() - startedAt });
    // 5XX: nunca se confirma éxito sin haber guardado de forma
    // duradera — Google reintentará.
    return NextResponse.json({ message: "No se pudo procesar el evento. Reintenta." }, { status: 500 });
  }
}
