import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/services/errors";
import { authenticateLeadCredential } from "@/services/lead-credentials.service";
import { intakeLead } from "@/services/leads.service";
import { checkLeadIntakeRateLimit } from "@/lib/lead-rate-limit";
import { logLeadIntakeEvent } from "@/lib/lead-observability";

// ---------------------------------------------------------------------------
// Recepción de leads — API autenticada por credencial (Fase 026).
//
// Independiente de la sesión de usuario (requireSessionUser) — es
// machine-to-machine, para que un formulario web o una integración de
// anuncios pueda enviar un lead sin cookies de navegador. La
// credencial determina `source`; nunca se confía en el campo `source`
// del payload (no existe tal campo en leadIntakeSchema).
//
// SIGUE SIENDO SÍNCRONA A PROPÓSITO (Preparación para producción,
// precisión #1 del usuario): `intakeLead` ya guarda el Lead dentro de
// una transacción Prisma y esta ruta solo responde DESPUÉS de que esa
// transacción confirma — eso YA satisface "recepción duradera" sin
// necesitar cola para este flujo. La cola (pg-boss) se reserva para
// los conectores que sí necesitan recuperación externa o
// procesamiento diferido (Google: nada que recuperar, llega ya
// completo; Meta: SÍ, requiere una llamada adicional a la Graph API —
// ver /api/leads/intake/meta).
//
// Límite de tamaño del payload: 32 KB es generoso para un formulario
// de contacto típico + formResponses (acotado a 8 KB por su propio
// schema) sin abrir la puerta a un payload de abuso.
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  const startedAt = Date.now();

  let credential;
  try {
    credential = await authenticateLeadCredential(request.headers.get("authorization"));
  } catch (error) {
    logLeadIntakeEvent({ correlationId, source: "WEB_API", result: "UNAUTHORIZED", durationMs: Date.now() - startedAt });
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  let rateLimit: { allowed: boolean; retryAfterSeconds?: number };
  try {
    rateLimit = await checkLeadIntakeRateLimit(credential.id);
  } catch {
    // Base de datos no disponible: nunca se devuelve éxito sin
    // procesar, pero tampoco se expone el detalle del error (nunca
    // stack trace ni SQL) — ver §7C/§7D.
    logLeadIntakeEvent({
      correlationId,
      source: credential.source,
      result: "DEPENDENCY_UNAVAILABLE",
      durationMs: Date.now() - startedAt,
      errorCategory: "rate_limit_store_unavailable",
    });
    return NextResponse.json({ error: "Servicio temporalmente no disponible. Intenta de nuevo." }, { status: 503 });
  }
  if (!rateLimit.allowed) {
    logLeadIntakeEvent({ correlationId, source: credential.source, result: "RATE_LIMITED", durationMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    logLeadIntakeEvent({ correlationId, source: credential.source, result: "PAYLOAD_TOO_LARGE", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "El cuerpo de la solicitud excede el límite permitido." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    logLeadIntakeEvent({ correlationId, source: credential.source, result: "INVALID_JSON", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  try {
    const result = await intakeLead(credential, payload);
    logLeadIntakeEvent({
      correlationId,
      source: credential.source,
      result: result.duplicate ? "DUPLICATE" : "CREATED",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        id: result.lead.id,
        duplicate: result.duplicate,
        stage: result.lead.stage,
        followUpStatus: result.lead.followUpStatus,
        personMatch: result.personMatch,
        relatedLeadCount: result.relatedLeads.length,
      },
      { status: result.duplicate ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof AppError) {
      // Nunca se filtra el payload recibido ni datos personales en el
      // mensaje de error más allá de lo que el propio AppError ya
      // produce (mensajes genéricos de validación, ver errors.ts).
      logLeadIntakeEvent({
        correlationId,
        source: credential.source,
        result: error.code === "CONFLICT" ? "CONFLICT" : "VALIDATION_ERROR",
        durationMs: Date.now() - startedAt,
        errorCategory: error.code,
      });
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    logLeadIntakeEvent({
      correlationId,
      source: credential.source,
      result: "UNEXPECTED_ERROR",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
