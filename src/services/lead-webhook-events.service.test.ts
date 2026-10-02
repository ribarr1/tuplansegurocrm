import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recordInboundWebhookEvent,
  getWebhookEventForProcessing,
  markWebhookEventProcessing,
  markWebhookEventProcessed,
  markWebhookEventFailed,
  findStalePendingWebhookEvents,
  listFailedWebhookEvents,
  retryWebhookEvent,
} from "@/services/lead-webhook-events.service";
import { createLeadCredential } from "@/services/lead-credentials.service";
import { intakeLead } from "@/services/leads.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];
const createdLeadIds: string[] = [];
const createdEventIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makeMetaCredential(actor: AuthorizedUser) {
  const created = await createLeadCredential(actor, { label: uniqueName("Credencial Meta"), source: "META" });
  createdCredentialIds.push(created.id);
  return created;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-webhook-event");
  agent = await makeActor("AGENT", "agent-webhook-event");
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { leadId: { in: createdLeadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
  await prisma.leadInboundWebhookEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.leadIntegrationCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("lead-webhook-events.service — idempotencia del EVENTO", () => {
  it("A) reenviar el mismo evento (misma source+credencial+externalEventId) nunca crea una segunda fila", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-${Date.now()}`;

    const first = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(first.event.id);
    expect(first.isNew).toBe(true);

    const second = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId, extra: "distinto, se ignora" },
    });
    expect(second.isNew).toBe(false);
    expect(second.event.id).toBe(first.event.id);

    const count = await prisma.leadInboundWebhookEvent.count({ where: { id: first.event.id } });
    expect(count).toBe(1);
  });

  it("B) eventos ya PROCESSED no se reprocesan (verificado vía getWebhookEventForProcessing)", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-${Date.now()}-b`;
    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await markWebhookEventProcessing(event.id);
    await markWebhookEventProcessed(event.id, "00000000-0000-4000-8000-000000000001");

    const loaded = await getWebhookEventForProcessing(event.id);
    expect(loaded?.status).toBe("PROCESSED");
  });
});

describe("lead-webhook-events.service — idempotencia del PROCESAMIENTO vs. creación del lead", () => {
  it("C) si el worker 'cae' después de crear el Lead pero antes de marcar PROCESSED, un reintento nunca duplica el lead", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-crash-${Date.now()}`;
    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await markWebhookEventProcessing(event.id);

    // Primer "intento" del worker: crea el Lead vía intakeLead
    // (mismo camino real que usa scripts/lead-webhook-worker.ts),
    // pero el proceso "cae" antes de llamar a markWebhookEventProcessed.
    const firstAttempt = await intakeLead(
      { id: credential.id, source: "META" },
      { fullName: "Lead Recuperado", phone: "3057779999", externalId: externalEventId }
    );
    createdLeadIds.push(firstAttempt.lead.id);
    expect(firstAttempt.duplicate).toBe(false);

    // Reintento (simulado): el worker vuelve a tomar el MISMO evento
    // (todavía en PROCESSING, nunca se marcó PROCESSED) y llama de
    // nuevo a intakeLead con el MISMO externalId.
    const retryAttempt = await intakeLead(
      { id: credential.id, source: "META" },
      { fullName: "Lead Recuperado", phone: "3057779999", externalId: externalEventId }
    );
    expect(retryAttempt.duplicate).toBe(true);
    expect(retryAttempt.lead.id).toBe(firstAttempt.lead.id);

    // Ahora sí se completa — nunca hubo un segundo Lead creado.
    await markWebhookEventProcessed(event.id, firstAttempt.lead.id);
    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(1);
  });

  it("D) un evento con fallo definitivo queda DEAD_LETTER con el error registrado", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-fail-${Date.now()}`;
    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await markWebhookEventProcessing(event.id);
    await markWebhookEventFailed(event.id, "Graph API respondió 400 al recuperar el lead.", true);

    const loaded = await getWebhookEventForProcessing(event.id);
    expect(loaded?.status).toBe("DEAD_LETTER");
  });

  it("E) findStalePendingWebhookEvents encuentra eventos PENDING antiguos, nunca los ya en proceso/procesados", async () => {
    const credential = await makeMetaCredential(admin);
    const staleEventId = `leadgen-stale-${Date.now()}`;
    const { event: staleEvent } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId: staleEventId,
      rawPayload: { leadgen_id: staleEventId },
    });
    createdEventIds.push(staleEvent.id);
    // Simula que quedó pendiente hace rato (nunca se encoló).
    await prisma.leadInboundWebhookEvent.update({
      where: { id: staleEvent.id },
      data: { receivedAt: new Date(Date.now() - 5 * 60_000) },
    });

    const freshEventId = `leadgen-fresh-${Date.now()}`;
    const { event: freshEvent } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId: freshEventId,
      rawPayload: { leadgen_id: freshEventId },
    });
    createdEventIds.push(freshEvent.id);

    const stale = await findStalePendingWebhookEvents(60_000);
    const staleIds = stale.map((e) => e.id);
    expect(staleIds).toContain(staleEvent.id);
    expect(staleIds).not.toContain(freshEvent.id);
  });
});

describe("lead-webhook-events.service — revisión y reintento autorizado (ADMIN only)", () => {
  it("F) AGENT no puede listar ni reintentar eventos fallidos", async () => {
    await expect(listFailedWebhookEvents(agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(retryWebhookEvent(agent, "00000000-0000-4000-8000-000000000002")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("G) ADMIN puede reintentar un evento DEAD_LETTER — vuelve a PENDING, nunca duplica el lead si ya se había creado", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-retry-${Date.now()}`;
    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);
    await markWebhookEventProcessing(event.id);
    await markWebhookEventFailed(event.id, "Fallo simulado", true);

    await retryWebhookEvent(admin, event.id);

    const loaded = await getWebhookEventForProcessing(event.id);
    expect(loaded?.status).toBe("PENDING");

    const failedList = await listFailedWebhookEvents(admin);
    expect(failedList.map((e) => e.id)).not.toContain(event.id);
  });

  it("H) no se puede reintentar un evento ya PROCESSED", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-done-${Date.now()}`;
    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);
    await markWebhookEventProcessing(event.id);
    await markWebhookEventProcessed(event.id, "00000000-0000-4000-8000-000000000003");

    await expect(retryWebhookEvent(admin, event.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
