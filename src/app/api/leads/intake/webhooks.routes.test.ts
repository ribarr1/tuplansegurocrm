import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLeadCredential, setGoogleConnectorSecrets, setMetaConnectorSecrets } from "@/services/lead-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Las rutas llaman a pg-boss (best-effort) tras guardar el evento; en
// esta prueba solo interesa lo que la ruta RECIBE y GUARDA, así que no
// se arranca la cola real contra la base de pruebas.
vi.mock("@/lib/lead-queue", () => ({
  enqueueLeadWebhookEventJob: vi.fn().mockResolvedValue(undefined),
  LEAD_WEBHOOK_EVENT_RETRY_LIMIT: 8,
}));

import { POST as googlePost } from "./google/route";
import { POST as metaPost } from "./meta/route";

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];
let admin: AuthorizedUser;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Admin Route Test",
      email: `admin.routes.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role: "ADMIN",
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  admin = { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
});

afterAll(async () => {
  await prisma.leadInboundWebhookEvent.deleteMany({ where: { integrationCredentialId: { in: createdCredentialIds } } });
  await prisma.leadRateLimitWindow.deleteMany({
    where: { OR: createdCredentialIds.flatMap((id) => [{ bucketKey: `google:${id}` }, { bucketKey: `meta:${id}` }]) },
  });
  await prisma.leadIntegrationCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

function request(url: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, { method: "POST", body, headers });
}

async function googleCredential(key: string) {
  const c = await createLeadCredential(admin, { label: `Google Route ${Date.now()}${Math.random()}`, source: "GOOGLE" });
  createdCredentialIds.push(c.id);
  await setGoogleConnectorSecrets(admin, c.id, { verificationKey: key });
  return c;
}

async function metaCredential(appSecret: string, pageId: string) {
  const c = await createLeadCredential(admin, { label: `Meta Route ${Date.now()}${Math.random()}`, source: "META" });
  createdCredentialIds.push(c.id);
  await setMetaConnectorSecrets(admin, c.id, {
    appSecret,
    pageAccessToken: "page-token-test",
    verifyToken: "verify-token-test",
    pageId,
  });
  return c;
}

function sign(body: string, secret: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("POST /api/leads/intake/google", () => {
  it("R1) payload de Google con ids numéricos: 200 {}, evento guardado con lead_id como texto, google_key REDACTADA y ids de 17 dígitos sin pérdida de precisión", async () => {
    const key = `test-google-key-${crypto.randomUUID()}`;
    const credential = await googleCredential(key);
    const leadId = `route-google-${Date.now()}`;
    const raw = `{"lead_id":"${leadId}","user_column_data":[{"column_id":"FULL_NAME","string_value":"A B"},{"column_id":"PHONE_NUMBER","string_value":"+16505550123"}],"form_id":349080077126,"campaign_id":12345678901234567,"google_key":"${key}","is_test":true}`;

    const response = await googlePost(request("/api/leads/intake/google", raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});

    const event = await prisma.leadInboundWebhookEvent.findFirstOrThrow({
      where: { integrationCredentialId: credential.id },
    });
    expect(event.externalEventId).toBe(leadId);
    const stored = event.rawPayload as Record<string, unknown>;
    expect(stored.google_key).toBe("[REDACTED]");
    expect(JSON.stringify(event)).not.toContain(key);
    expect(stored.campaign_id).toBe("12345678901234567");
    expect(stored.form_id).toBe(349080077126);
  });

  it("R2) reenviar el mismo lead_id no crea un segundo evento", async () => {
    const key = `test-google-key-${crypto.randomUUID()}`;
    const credential = await googleCredential(key);
    const leadId = `route-google-dup-${Date.now()}`;
    const raw = JSON.stringify({ lead_id: leadId, google_key: key, campaign_id: 1 });
    expect((await googlePost(request("/api/leads/intake/google", raw))).status).toBe(200);
    expect((await googlePost(request("/api/leads/intake/google", raw))).status).toBe(200);
    expect(await prisma.leadInboundWebhookEvent.count({ where: { integrationCredentialId: credential.id } })).toBe(1);
  });

  it("R3) google_key incorrecta -> 401 sin guardar nada; google_key de tipo inválido -> 4xx (nunca 500)", async () => {
    const key = `test-google-key-${crypto.randomUUID()}`;
    const credential = await googleCredential(key);
    const bad = await googlePost(request("/api/leads/intake/google", JSON.stringify({ lead_id: "x-bad", google_key: "otra-clave" })));
    expect(bad.status).toBe(401);
    const numeric = await googlePost(request("/api/leads/intake/google", JSON.stringify({ lead_id: "x-num", google_key: 12345 })));
    expect(numeric.status).toBe(400);
    const notObject = await googlePost(request("/api/leads/intake/google", "null"));
    expect(notObject.status).toBe(400);
    expect(await prisma.leadInboundWebhookEvent.count({ where: { integrationCredentialId: credential.id } })).toBe(0);
  });
});

describe("POST /api/leads/intake/meta (notificación leadgen)", () => {
  it("R4) notificación oficial con leadgen_id y page_id NUMÉRICOS: 200 y evento guardado con id de texto (antes: error 500 / evento descartado)", async () => {
    const secret = `meta-app-secret-${crypto.randomUUID()}`;
    const credential = await metaCredential(secret, "123123123");
    const leadgenId = `${Date.now()}`;
    const raw = `{"object":"page","entry":[{"id":123123123,"time":1438292065,"changes":[{"field":"leadgen","value":{"leadgen_id":${leadgenId},"page_id":123123123,"form_id":12312312312,"adgroup_id":12312312312,"ad_id":12312312312,"created_time":1440120384}}]}]}`;

    const response = await metaPost(request("/api/leads/intake/meta", raw, { "x-hub-signature-256": sign(raw, secret) }));
    expect(response.status).toBe(200);

    const events = await prisma.leadInboundWebhookEvent.findMany({ where: { integrationCredentialId: credential.id } });
    expect(events).toHaveLength(1);
    expect(events[0].externalEventId).toBe(leadgenId);
  });

  it("R5) un evento de OTRA página no se procesa bajo esta credencial (200 sin guardar)", async () => {
    const secret = `meta-app-secret-${crypto.randomUUID()}`;
    const credential = await metaCredential(secret, "123123123");
    const raw = `{"entry":[{"changes":[{"field":"leadgen","value":{"leadgen_id":999001,"page_id":555555555}}]}]}`;
    const response = await metaPost(request("/api/leads/intake/meta", raw, { "x-hub-signature-256": sign(raw, secret) }));
    expect(response.status).toBe(200);
    expect(await prisma.leadInboundWebhookEvent.count({ where: { integrationCredentialId: credential.id } })).toBe(0);
  });

  it("R6) firma inválida -> 403 sin guardar nada", async () => {
    const secret = `meta-app-secret-${crypto.randomUUID()}`;
    const credential = await metaCredential(secret, "123123123");
    const raw = `{"entry":[{"changes":[{"field":"leadgen","value":{"leadgen_id":999002,"page_id":123123123}}]}]}`;
    const response = await metaPost(request("/api/leads/intake/meta", raw, { "x-hub-signature-256": sign(raw, "otro-secreto") }));
    expect(response.status).toBe(403);
    expect(await prisma.leadInboundWebhookEvent.count({ where: { integrationCredentialId: credential.id } })).toBe(0);
  });
});
