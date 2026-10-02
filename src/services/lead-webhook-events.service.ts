import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { enqueueLeadWebhookEventJob, LEAD_WEBHOOK_EVENT_RETRY_LIMIT } from "@/lib/lead-queue";
import { recordAuditEvent } from "@/services/audit.service";
import type { LeadSource, Prisma } from "@/generated/prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Registro durable de eventos entrantes de webhooks (Google/Meta) —
// Fase 026, Preparación para producción (§6-§7A).
//
// Distingue DOS idempotencias (ver prisma/schema.prisma, modelo
// LeadInboundWebhookEvent):
//   1. Del EVENTO de la plataforma: @@unique([source,
//      integrationCredentialId, externalEventId]) — un reenvío del
//      MISMO evento nunca crea una segunda fila.
//   2. De la CREACIÓN del lead: delegada enteramente a
//      intakeLead()/Lead.originalPayloadSnapshot (ya implementada) —
//      el worker llama exactamente a esa función, nunca duplica su
//      lógica de negocio.
// ---------------------------------------------------------------------------

export async function recordInboundWebhookEvent(input: {
  source: LeadSource;
  integrationCredentialId: string;
  externalEventId: string;
  rawPayload: Prisma.InputJsonValue;
}): Promise<{ event: { id: string }; isNew: boolean }> {
  // create() + capturar P2002 en vez de upsert: un reenvío de la
  // MISMA plataforma para el MISMO evento nunca falla ni se trata
  // como error — se reconoce el registro ya existente tal cual,
  // sin tocar su rawPayload ni reiniciar su estado de procesamiento
  // (mismo patrón que intakeLead's manejo de condiciones de carrera).
  try {
    const created = await prisma.leadInboundWebhookEvent.create({
      data: {
        source: input.source,
        integrationCredentialId: input.integrationCredentialId,
        externalEventId: input.externalEventId,
        rawPayload: input.rawPayload,
      },
      select: { id: true },
    });
    return { event: created, isNew: true };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      const existing = await prisma.leadInboundWebhookEvent.findUniqueOrThrow({
        where: {
          source_integrationCredentialId_externalEventId: {
            source: input.source,
            integrationCredentialId: input.integrationCredentialId,
            externalEventId: input.externalEventId,
          },
        },
        select: { id: true },
      });
      return { event: existing, isNew: false };
    }
    throw error;
  }
}

export async function enqueueInboundWebhookEvent(eventId: string): Promise<void> {
  await enqueueLeadWebhookEventJob(eventId);
}

export async function getWebhookEventForProcessing(eventId: string) {
  return prisma.leadInboundWebhookEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      source: true,
      integrationCredentialId: true,
      externalEventId: true,
      rawPayload: true,
      status: true,
      attempts: true,
      integrationCredential: {
        select: { id: true, source: true, isActive: true, connectorSecrets: true, customFieldMapping: true },
      },
    },
  });
}

export async function markWebhookEventProcessing(eventId: string): Promise<void> {
  await prisma.leadInboundWebhookEvent.update({
    where: { id: eventId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
}

export async function markWebhookEventProcessed(eventId: string, createdLeadId: string): Promise<void> {
  await prisma.leadInboundWebhookEvent.update({
    where: { id: eventId },
    data: { status: "PROCESSED", processedAt: new Date(), createdLeadId },
  });
}

export async function markWebhookEventFailed(eventId: string, error: string, isFinal: boolean): Promise<void> {
  await prisma.leadInboundWebhookEvent.update({
    where: { id: eventId },
    // Nunca el stack trace ni datos del payload en `lastError` — solo
    // un mensaje corto y seguro (ver docs/SECURITY.md).
    data: { status: isFinal ? "DEAD_LETTER" : "FAILED", lastError: error.slice(0, 500) },
  });
}

// Eventos PENDING que no se recogieron a tiempo (el `send` de la ruta
// del webhook fue "mejor esfuerzo") — barrido periódico, ver
// scripts/lead-webhook-worker.ts.
export async function findStalePendingWebhookEvents(olderThanMs: number): Promise<{ id: string }[]> {
  return prisma.leadInboundWebhookEvent.findMany({
    where: { status: "PENDING", receivedAt: { lt: new Date(Date.now() - olderThanMs) } },
    select: { id: true },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Revisión y reintento autorizado (§7A) — ADMIN only. Reintentar es
// SEGURO sin duplicar leads: vuelve a encolar el MISMO evento, y
// `intakeLead` reconoce el lead ya creado (si lo hubiera) por su
// `externalId`/`idempotencyKey`.
// ---------------------------------------------------------------------------
function assertAdmin(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede revisar/reintentar eventos de webhook.");
  }
}

export async function listFailedWebhookEvents(actor: AuthorizedUser) {
  assertAdmin(actor);
  return prisma.leadInboundWebhookEvent.findMany({
    where: { status: { in: ["FAILED", "DEAD_LETTER"] } },
    select: {
      id: true,
      source: true,
      externalEventId: true,
      status: true,
      attempts: true,
      lastError: true,
      receivedAt: true,
      integrationCredential: { select: { label: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
}

const webhookEventIdSchema = z.uuid("Identificador de evento inválido.");

export async function retryWebhookEvent(actor: AuthorizedUser, rawId: unknown): Promise<void> {
  assertAdmin(actor);
  const id = parseOrThrow(webhookEventIdSchema, rawId);

  const event = await prisma.leadInboundWebhookEvent.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!event) throw new AppError("NOT_FOUND", "Evento no encontrado.");
  if (event.status === "PROCESSED") {
    throw new AppError("CONFLICT", "Este evento ya fue procesado correctamente.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.leadInboundWebhookEvent.update({ where: { id }, data: { status: "PENDING", lastError: null } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "LeadInboundWebhookEvent",
      entityId: id,
      action: "LEAD_WEBHOOK_EVENT_RETRY",
      summary: "Reintento autorizado de un evento de webhook fallido",
    });
  });
  await enqueueLeadWebhookEventJob(id);
}

export const MAX_WEBHOOK_EVENT_ATTEMPTS = LEAD_WEBHOOK_EVENT_RETRY_LIMIT;
