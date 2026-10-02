import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createLeadCredential,
  listLeadCredentials,
  revokeLeadCredential,
  authenticateLeadCredential,
  setGoogleConnectorSecrets,
  setMetaConnectorSecrets,
  getDecryptedConnectorSecrets,
  findActiveCredentialBySource,
  setCustomFieldMapping,
} from "@/services/lead-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCredentialIds: string[] = [];

function trackCredential<T extends { id: string }>(c: T): T {
  createdCredentialIds.push(c.id);
  return c;
}

function uniqueLabel(label: string) {
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

let admin: AuthorizedUser;
let agent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-credential");
  agent = await makeActor("AGENT", "agent-credential");
});

afterAll(async () => {
  await prisma.leadIntegrationCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("lead-credentials.service", () => {
  it("A) ADMIN crea una credencial y recibe el secreto UNA sola vez", async () => {
    const created = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial A"), source: "WEB" })
    );
    expect(created.secret).toBeTruthy();
    expect(created.authorizationHeaderValue).toBe(`Bearer ${created.credentialKey}.${created.secret}`);

    const stored = await prisma.leadIntegrationCredential.findUnique({ where: { id: created.id } });
    expect(stored?.hashedSecret).not.toBe(created.secret);
  });

  it("B) MANUAL no es una fuente de integración válida", async () => {
    await expect(
      createLeadCredential(admin, { label: uniqueLabel("Credencial B"), source: "MANUAL" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("C) AGENT no puede crear credenciales", async () => {
    await expect(
      createLeadCredential(agent, { label: uniqueLabel("Credencial C"), source: "WEB" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("D) authenticateLeadCredential acepta el secreto correcto y rechaza uno incorrecto", async () => {
    const created = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial D"), source: "GOOGLE" })
    );

    const authenticated = await authenticateLeadCredential(`Bearer ${created.credentialKey}.${created.secret}`);
    expect(authenticated.id).toBe(created.id);
    expect(authenticated.source).toBe("GOOGLE");

    await expect(
      authenticateLeadCredential(`Bearer ${created.credentialKey}.wrong-secret`)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(authenticateLeadCredential(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(authenticateLeadCredential("NotBearer xyz")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("E) revokeLeadCredential desactiva y authenticateLeadCredential la rechaza después", async () => {
    const created = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial E"), source: "META" })
    );
    await revokeLeadCredential(admin, created.id);

    await expect(
      authenticateLeadCredential(`Bearer ${created.credentialKey}.${created.secret}`)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("F) listLeadCredentials nunca expone hashedSecret", async () => {
    trackCredential(await createLeadCredential(admin, { label: uniqueLabel("Credencial F"), source: "WEB" }));
    const list = await listLeadCredentials(admin);
    for (const c of list) {
      expect(c).not.toHaveProperty("hashedSecret");
    }
  });

  it("G) setGoogleConnectorSecrets guarda cifrado y nunca aparece en claro en listLeadCredentials", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial G"), source: "GOOGLE" })
    );
    await setGoogleConnectorSecrets(admin, credential.id, { verificationKey: "clave-google-real-123" });

    const list = await listLeadCredentials(admin);
    const found = list.find((c) => c.id === credential.id);
    expect(found?.hasConnectorSecrets).toBe(true);
    expect(JSON.stringify(found)).not.toContain("clave-google-real-123");

    const decrypted = await getDecryptedConnectorSecrets(credential.id);
    expect(decrypted).toEqual({ provider: "GOOGLE", verificationKey: "clave-google-real-123" });
  });

  it("H) setGoogleConnectorSecrets rechaza una credencial que no es de fuente GOOGLE", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial H"), source: "META" })
    );
    await expect(
      setGoogleConnectorSecrets(admin, credential.id, { verificationKey: "clave-google-123" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("I) setMetaConnectorSecrets guarda los 4 campos cifrados y findActiveCredentialBySource los expone solo cifrados", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial I"), source: "META" })
    );
    await setMetaConnectorSecrets(admin, credential.id, {
      appSecret: "app-secret-real",
      pageAccessToken: "page-token-real",
      verifyToken: "verify-token-real",
      pageId: "9999999999",
    });

    const decrypted = await getDecryptedConnectorSecrets(credential.id);
    expect(decrypted).toEqual({
      provider: "META",
      appSecret: "app-secret-real",
      pageAccessToken: "page-token-real",
      verifyToken: "verify-token-real",
      pageId: "9999999999",
    });

    const activeMeta = await findActiveCredentialBySource("META");
    const found = activeMeta.find((c) => c.id === credential.id);
    expect(found?.connectorSecrets).not.toBeNull();
    expect(found?.connectorSecrets).not.toContain("app-secret-real");
  });

  it("J) AGENT no puede configurar secretos de conector", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial J"), source: "GOOGLE" })
    );
    await expect(
      setGoogleConnectorSecrets(agent, credential.id, { verificationKey: "clave-123" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("K) getDecryptedConnectorSecrets devuelve null si nunca se configuró", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial K"), source: "GOOGLE" })
    );
    expect(await getDecryptedConnectorSecrets(credential.id)).toBeNull();
  });

  it("L) setCustomFieldMapping (§6) guarda el mapeo en claro (no es secreto) y se expone en listLeadCredentials", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial L"), source: "GOOGLE" })
    );
    await setCustomFieldMapping(admin, credential.id, {
      residenceStateFieldKey: "custom_state_99",
      productInterestFieldKey: "custom_product_11",
    });

    const list = await listLeadCredentials(admin);
    const found = list.find((c) => c.id === credential.id);
    expect(found?.customFieldMapping).toEqual({
      residenceStateFieldKey: "custom_state_99",
      productInterestFieldKey: "custom_product_11",
    });
  });

  it("M) setCustomFieldMapping rechaza credenciales que no son GOOGLE/META (ej. WEB)", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial M"), source: "WEB" })
    );
    await expect(
      setCustomFieldMapping(admin, credential.id, { residenceStateFieldKey: "x" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("N) AGENT no puede configurar el mapeo de preguntas personalizadas", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial N"), source: "META" })
    );
    await expect(
      setCustomFieldMapping(agent, credential.id, { residenceStateFieldKey: "x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("O) enviar ambos campos vacíos borra el mapeo (vuelve a null, nunca un objeto vacío fantasma)", async () => {
    const credential = trackCredential(
      await createLeadCredential(admin, { label: uniqueLabel("Credencial O"), source: "META" })
    );
    await setCustomFieldMapping(admin, credential.id, { residenceStateFieldKey: "temp" });
    await setCustomFieldMapping(admin, credential.id, {});

    const list = await listLeadCredentials(admin);
    const found = list.find((c) => c.id === credential.id);
    expect(found?.customFieldMapping).toBeNull();
  });
});
