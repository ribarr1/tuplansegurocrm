import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { processWebhookEvent } from "./lead-webhook-worker";
import { recordInboundWebhookEvent, markWebhookEventProcessing } from "@/services/lead-webhook-events.service";
import { createLeadCredential, revokeLeadCredential, setMetaConnectorSecrets } from "@/services/lead-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Prueba de scripts/lead-webhook-worker.ts::processWebhookEvent — la
// pieza que de verdad ejecuta el worker de producción, llamada
// DIRECTAMENTE (no vía pg-boss) para poder controlar cada escenario.
// Importar este módulo sin invocar main() como efecto secundario
// depende de la guarda de punto de entrada añadida en
// lead-webhook-worker.ts (import.meta.url === pathToFileURL(argv[1])).

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];
const createdLeadIds: string[] = [];
const createdEventIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${role} Worker Test`,
      email: `${role.toLowerCase()}.worker.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makeMetaCredential(actor: AuthorizedUser) {
  const created = await createLeadCredential(actor, { label: uniqueName("Credencial Meta Worker"), source: "META" });
  createdCredentialIds.push(created.id);
  await setMetaConnectorSecrets(actor, created.id, {
    appSecret: "app-secret-test",
    pageAccessToken: "page-token-test",
    verifyToken: "verify-token-test",
    pageId: "1234567890",
  });
  return created;
}

let admin: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { leadId: { in: createdLeadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
  await prisma.leadInboundWebhookEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.leadIntegrationCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

// getWebhookEventForProcessing() solo selecciona lo que el worker
// necesita para procesar (no createdLeadId/lastError) — para
// verificar el resultado final de cada escenario se consulta
// directamente, igual que el resto de la suite de este módulo.
function loadEventResult(eventId: string) {
  return prisma.leadInboundWebhookEvent.findUnique({
    where: { id: eventId },
    select: { status: true, createdLeadId: true, lastError: true },
  });
}

function stubGraphApiResponse(fieldData: { name: string; values: string[] }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ field_data: fieldData, created_time: "2026-01-01T00:00:00Z" }),
    })
  );
}

describe("lead-webhook-worker — processWebhookEvent (§4, verificaciones de operación)", () => {
  it("A) procesa un evento META válido: crea el Lead exactamente una vez y marca PROCESSED", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-worker-${Date.now()}`;
    stubGraphApiResponse([
      { name: "full_name", values: ["Worker Test Lead"] },
      { name: "phone_number", values: ["3051230000"] },
    ]);

    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await processWebhookEvent(event.id);

    const loaded = await loadEventResult(event.id);
    expect(loaded?.status).toBe("PROCESSED");
    expect(loaded?.createdLeadId).toBeTruthy();
    if (loaded?.createdLeadId) createdLeadIds.push(loaded.createdLeadId);

    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(1);
  });

  it("B) reenviar el mismo evento ya PROCESSED no reprocesa ni llama a la Graph API de nuevo", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-worker-resend-${Date.now()}`;
    stubGraphApiResponse([
      { name: "full_name", values: ["Resend Lead"] },
      { name: "phone_number", values: ["3051230001"] },
    ]);

    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await processWebhookEvent(event.id);
    const afterFirst = await loadEventResult(event.id);
    if (afterFirst?.createdLeadId) createdLeadIds.push(afterFirst.createdLeadId);
    expect(afterFirst?.status).toBe("PROCESSED");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Reintento del mismo evento (ej. el barrido lo volvió a encolar
    // por error, o pg-boss reintentó tras un timeout de red) — ya
    // está PROCESSED, así que ni siquiera debe llamar a la Graph API.
    await processWebhookEvent(event.id);
    expect(fetchSpy).not.toHaveBeenCalled();

    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(1);
  });

  it("C) worker 'detenido' a mitad de proceso (evento en PROCESSING sin completar): al reintentar, nunca duplica el lead", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-worker-crash-${Date.now()}`;
    stubGraphApiResponse([
      { name: "full_name", values: ["Crash Recovery Lead"] },
      { name: "phone_number", values: ["3051230002"] },
    ]);

    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    // Simula que el worker anterior alcanzó a marcar PROCESSING (y
    // posiblemente a crear el Lead) pero "cayó" antes de terminar —
    // ver escenario C en lead-webhook-events.service.test.ts para la
    // prueba de más bajo nivel de esta misma garantía.
    await markWebhookEventProcessing(event.id);

    await processWebhookEvent(event.id);
    const loaded = await loadEventResult(event.id);
    expect(loaded?.status).toBe("PROCESSED");
    if (loaded?.createdLeadId) createdLeadIds.push(loaded.createdLeadId);

    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(1);
  });

  it("D) error de recuperación externa (Graph API falla): el evento queda para reintento, nunca se crea un lead a medias", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-worker-graphfail-${Date.now()}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );

    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    await expect(processWebhookEvent(event.id)).rejects.toThrow(/Graph API respondió 503/);

    const loaded = await loadEventResult(event.id);
    // Con 1 intento registrado y el límite de reintentos configurado
    // en LEAD_WEBHOOK_EVENT_RETRY_LIMIT (8), todavía no es definitivo.
    expect(loaded?.status).toBe("FAILED");
    expect(loaded?.lastError).toMatch(/Graph API respondió 503/);
    expect(loaded?.createdLeadId).toBeNull();

    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(0);

    // Reintento posterior (ej. pg-boss tras su retryDelay, o un ADMIN
    // vía retryWebhookEvent) con la Graph API ya recuperada — el
    // evento se procesa normalmente, sin rastro del fallo anterior
    // bloqueando el flujo.
    stubGraphApiResponse([
      { name: "full_name", values: ["Recovered After Retry"] },
      { name: "phone_number", values: ["3051230003"] },
    ]);
    await processWebhookEvent(event.id);
    const recovered = await loadEventResult(event.id);
    expect(recovered?.status).toBe("PROCESSED");
    if (recovered?.createdLeadId) createdLeadIds.push(recovered.createdLeadId);
  });

  it("E) credencial revocada con el evento aún pendiente: pasa a DEAD_LETTER de inmediato, SIN llamar a la Graph API ni crear un lead", async () => {
    const credential = await makeMetaCredential(admin);
    const externalEventId = `leadgen-worker-revoked-${Date.now()}`;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { event } = await recordInboundWebhookEvent({
      source: "META",
      integrationCredentialId: credential.id,
      externalEventId,
      rawPayload: { leadgen_id: externalEventId },
    });
    createdEventIds.push(event.id);

    // La credencial se revoca DESPUÉS de recibir el evento pero ANTES
    // de que el worker llegue a procesarlo (ej. job todavía en cola).
    await revokeLeadCredential(admin, credential.id);

    await processWebhookEvent(event.id);

    const loaded = await loadEventResult(event.id);
    expect(loaded?.status).toBe("DEAD_LETTER");
    expect(loaded?.lastError).toBe("La credencial de integración fue revocada.");
    expect(loaded?.createdLeadId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    const leadCount = await prisma.lead.count({
      where: { integrationCredentialId: credential.id, externalId: externalEventId },
    });
    expect(leadCount).toBe(0);
  });

  it("F) evento para un id inexistente: no lanza, simplemente no hace nada (defensivo ante una fila borrada entre el encolado y el procesamiento)", async () => {
    await expect(processWebhookEvent("00000000-0000-4000-8000-000000000099")).resolves.toBeUndefined();
  });
});
