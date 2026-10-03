import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { processWebhookEvent } from "./lead-webhook-worker";
import { recordInboundWebhookEvent } from "@/services/lead-webhook-events.service";
import { createLeadCredential, setMetaConnectorSecrets } from "@/services/lead-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Regresión de producción (evento real 8b77c063-…): el payload de la
// prueba de Google Ads trae campaign_id/form_id/... como NÚMERO y el
// worker fallaba con "campaignId: expected string, received number".
// Ejercita la función REAL del worker (processWebhookEvent) contra la
// base de pruebas aislada. Meta: la Graph API se SIMULA con un mock de
// fetch (sin credenciales ni cuentas reales). La google_key es un
// placeholder.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];
const createdLeadIds: string[] = [];
const createdEventIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

let admin: AuthorizedUser;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Admin Regression Test",
      email: `admin.regression.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role: "ADMIN",
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  admin = { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
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

async function makeCredential(source: "GOOGLE" | "META") {
  const created = await createLeadCredential(admin, { label: uniqueName(`Credencial ${source} Regresión`), source });
  createdCredentialIds.push(created.id);
  if (source === "META") {
    await setMetaConnectorSecrets(admin, created.id, {
      appSecret: "app-secret-test",
      pageAccessToken: "page-token-test",
      verifyToken: "verify-token-test",
      pageId: "123123123",
    });
  }
  return created;
}

function googleTestPayload(leadId: string, overrides: Record<string, unknown> = {}) {
  return {
    lead_id: leadId,
    user_column_data: [
      { column_name: "Full Name", string_value: "FirstName LastName", column_id: "FULL_NAME" },
      { column_name: "User Email", string_value: "test@example.com", column_id: "EMAIL" },
      { column_name: "User Phone", string_value: "+16505550123", column_id: "PHONE_NUMBER" },
      { column_name: "City", string_value: "Mountain View", column_id: "CITY" },
      { column_name: "Postal Code", string_value: "94043", column_id: "POSTAL_CODE" },
      { column_name: "Region", string_value: "California", column_id: "REGION" },
    ],
    api_version: "1.0",
    form_id: 349080077126,
    campaign_id: 23729418209,
    google_key: "[REDACTED]",
    is_test: true,
    gcl_id: "TeSter-123",
    adgroup_id: 195583084496,
    creative_id: 30000000000,
    ...overrides,
  };
}

async function recordEvent(
  source: "GOOGLE" | "META",
  credentialId: string,
  externalEventId: string,
  rawPayload: Record<string, unknown>
) {
  const { event } = await recordInboundWebhookEvent({
    source,
    integrationCredentialId: credentialId,
    externalEventId,
    rawPayload: rawPayload as never,
  });
  createdEventIds.push(event.id);
  return event.id;
}

function leadsFor(credentialId: string, externalId: string) {
  return prisma.lead.findMany({ where: { integrationCredentialId: credentialId, externalId } });
}

function eventResult(eventId: string) {
  return prisma.leadInboundWebhookEvent.findUnique({
    where: { id: eventId },
    select: { status: true, lastError: true },
  });
}

describe("worker — Google: payload real de la prueba (is_test) con identificadores numéricos", () => {
  it("G1) procesa el payload completo: UN lead, campaignId como texto, datos mapeados, REGION/CITY/POSTAL_CODE en formResponses, sin consentimiento inventado ni google_key", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-real-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId));

    await processWebhookEvent(eventId);

    expect((await eventResult(eventId))?.status).toBe("PROCESSED");
    const leads = await leadsFor(credential.id, leadId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
    const lead = leads[0];
    expect(lead.fullName).toBe("FirstName LastName");
    expect(lead.email).toBe("test@example.com");
    expect(lead.phone).toBe("+16505550123");
    expect(lead.campaignId).toBe("23729418209");
    expect(lead.source).toBe("GOOGLE");
    expect(lead.residenceState).toBeNull();
    expect(lead.consentGiven).toBeNull();
    expect(lead.formResponses).toEqual({ City: "Mountain View", "Postal Code": "94043", Region: "California" });
    expect(JSON.stringify(lead)).not.toContain("google_key");
  });

  it("G2) reprocesar el mismo evento (aun forzándolo de nuevo a PENDING) nunca duplica el lead", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-reprocess-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId));

    await processWebhookEvent(eventId);
    await processWebhookEvent(eventId); // ya PROCESSED: no-op
    // Simula el worker que cayó antes de marcar PROCESSED: intakeLead
    // reconoce el lead ya creado por su externalId.
    await prisma.leadInboundWebhookEvent.update({ where: { id: eventId }, data: { status: "PENDING" } });
    await processWebhookEvent(eventId);

    const leads = await leadsFor(credential.id, leadId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
    expect((await eventResult(eventId))?.status).toBe("PROCESSED");
  });

  it("G3) falla seguida de reintento exitoso: un id numérico no seguro falla visiblemente sin crear lead; corregido el evento, se crea UN solo lead", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-unsafe-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId, { campaign_id: 2 ** 60 }));

    await expect(processWebhookEvent(eventId)).rejects.toThrow(/campaign_id.*no seguro/);
    const failed = await eventResult(eventId);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.lastError).not.toContain(String(2 ** 60));
    expect(await leadsFor(credential.id, leadId)).toHaveLength(0);

    // Corrección solo dentro de esta prueba, sobre una fila de prueba.
    await prisma.leadInboundWebhookEvent.update({
      where: { id: eventId },
      data: { rawPayload: googleTestPayload(leadId) as never },
    });
    await processWebhookEvent(eventId);

    const leads = await leadsFor(credential.id, leadId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
  });

  it("G4) la comparación contra la instantánea inmutable se mantiene: mismo lead_id con datos distintos termina en CONFLICT y no altera el lead", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-conflict-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId));
    await processWebhookEvent(eventId);
    const [original] = await leadsFor(credential.id, leadId);
    createdLeadIds.push(original.id);

    await prisma.leadInboundWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: "PENDING",
        rawPayload: googleTestPayload(leadId, {
          user_column_data: [
            { column_name: "Full Name", string_value: "Otra Persona", column_id: "FULL_NAME" },
            { column_name: "User Phone", string_value: "+13055550000", column_id: "PHONE_NUMBER" },
          ],
        }) as never,
      },
    });
    await expect(processWebhookEvent(eventId)).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await leadsFor(credential.id, leadId);
    expect(after).toHaveLength(1);
    expect(after[0].fullName).toBe("FirstName LastName");
  });

  it("G6) un id de 64 bits ya guardado como NÚMERO en jsonb (precisión ya perdida al leerlo) se rechaza explícitamente: sin lead, sin reconstruir el valor original", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-lossy-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId));
    // jsonb conserva el numeral exacto en la base; al leerlo, JS lo
    // convierte a un Number que ya NO es seguro.
    const payloadWithBigNumber = JSON.stringify(googleTestPayload(leadId)).replace(
      '"campaign_id":23729418209',
      '"campaign_id":12345678901234567'
    );
    expect(payloadWithBigNumber).toContain("12345678901234567");
    await prisma.$executeRaw`UPDATE lead_inbound_webhook_events SET "rawPayload" = ${payloadWithBigNumber}::jsonb WHERE id = ${eventId}::uuid`;

    await expect(processWebhookEvent(eventId)).rejects.toThrow(/campaign_id.*no seguro/);
    const failed = await eventResult(eventId);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.lastError).not.toContain("12345678901234567");
    expect(failed?.lastError).not.toContain("12345678901234568");
    expect(await leadsFor(credential.id, leadId)).toHaveLength(0);
  });

  it("G5) un evento con la clave redactada (como los que guarda la ruta ahora) se procesa igual", async () => {
    const credential = await makeCredential("GOOGLE");
    const leadId = `google-redacted-${Date.now()}`;
    const eventId = await recordEvent("GOOGLE", credential.id, leadId, googleTestPayload(leadId, { google_key: "[REDACTED]" }));
    await processWebhookEvent(eventId);
    const leads = await leadsFor(credential.id, leadId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
  });
});

describe("worker — Meta (Graph API SIMULADA): leadgen_id numérico y valores fuera de catálogo", () => {
  it("M1) leadgen_id numérico en la notificación: se consulta la Graph API con el id como texto y se crea UN lead; state='Florida' no hace fallar el lead", async () => {
    const credential = await makeCredential("META");
    const leadgenId = String(Date.now()).slice(0, 13) + "7";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: leadgenId,
        created_time: "2015-02-28T08:49:14+0000",
        field_data: [
          { name: "full_name", values: ["Joe Example"] },
          { name: "email", values: ["joe@example.com"] },
          { name: "phone_number", values: ["+13055550199"] },
          { name: "state", values: ["Florida"] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Forma exacta de la notificación oficial: ids como NÚMERO.
    const eventId = await recordEvent("META", credential.id, leadgenId, {
      leadgen_id: Number(leadgenId),
      page_id: 123123123,
      form_id: 12312312312,
      created_time: 1440120384,
    });

    await processWebhookEvent(eventId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/${leadgenId}?`);
    const leads = await leadsFor(credential.id, leadgenId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
    expect(leads[0].residenceState).toBeNull();
    expect(leads[0].formResponses).toEqual({ state: "Florida" });
    expect(leads[0].consentGiven).toBeNull();
    expect((await eventResult(eventId))?.status).toBe("PROCESSED");
  });

  it("M2) falla de la Graph API y reintento exitoso con el id numérico: sin duplicados", async () => {
    const credential = await makeCredential("META");
    const leadgenId = String(Date.now()).slice(0, 13) + "8";
    const eventId = await recordEvent("META", credential.id, leadgenId, {
      leadgen_id: Number(leadgenId),
      page_id: 123123123,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(processWebhookEvent(eventId)).rejects.toThrow(/Graph API respondió 500/);
    expect(await leadsFor(credential.id, leadgenId)).toHaveLength(0);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          field_data: [
            { name: "full_name", values: ["Recovered Meta"] },
            { name: "phone_number", values: ["+13055550198"] },
          ],
        }),
      })
    );
    await processWebhookEvent(eventId);
    const leads = await leadsFor(credential.id, leadgenId);
    expect(leads).toHaveLength(1);
    createdLeadIds.push(leads[0].id);
  });
});
