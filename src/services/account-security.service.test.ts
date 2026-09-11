import { describe, it, expect, afterAll, afterEach } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { changeOwnPassword, requestEmailChange } from "@/services/account-security.service";
import { setEmailTransportForTests, createNoopEmailTransportForTests, type EmailMessage } from "@/lib/email";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — Sección 6: autoservicio de cambio de contraseña/correo
// para un usuario YA autenticado. Todos los datos son sintéticos.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
let sentEmails: EmailMessage[] = [];

function recordingTransport() {
  return {
    async send(message: EmailMessage) {
      sentEmails.push(message);
    },
  };
}

function uniqueEmail(label: string) {
  return `${label}.${Date.now()}${Math.random().toString(36).slice(2)}@test.local`;
}

async function makeActiveUser(password: string): Promise<AuthorizedUser> {
  const email = uniqueEmail("account-security");
  const user = await prisma.user.create({
    data: { name: "Account Security Test", email, role: "AGENT", isActive: true, activatedAt: new Date() },
  });
  createdUserIds.push(user.id);
  await prisma.account.create({
    data: {
      issuer: "local:credential",
      providerId: "credential",
      accountId: user.id,
      userId: user.id,
      password: await hashPassword(password),
    },
  });
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function getSessionHeadersFor(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = response.headers.get("set-cookie");
  const cookiePair = setCookie?.split(";")[0];
  if (!cookiePair) throw new Error("no session cookie");
  return new Headers({ cookie: cookiePair });
}

afterEach(() => {
  sentEmails = [];
  setEmailTransportForTests(recordingTransport());
});

afterAll(async () => {
  setEmailTransportForTests(createNoopEmailTransportForTests());
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("account-security.service — cambio de contraseña (autoservicio)", () => {
  it("A) cambiar la propia contraseña con la actual correcta funciona y permite iniciar sesión con la nueva", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);

    const newPassword = "ContraseñaNuevaSegura2026";
    const result = await changeOwnPassword(actor, { currentPassword: password, newPassword, confirmPassword: newPassword }, headers);
    expect(result.success).toBe(true);

    const signIn = await auth.api.signInEmail({ body: { email: actor.email, password: newPassword }, asResponse: true });
    expect(signIn.status).toBe(200);
  });

  it("B) contraseña actual incorrecta se rechaza — nunca cambia nada", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);

    await expect(
      changeOwnPassword(actor, { currentPassword: "IncorrectaDeVerdad", newPassword: "OtraNueva2026", confirmPassword: "OtraNueva2026" }, headers)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const stillWorks = await auth.api.signInEmail({ body: { email: actor.email, password }, asResponse: true });
    expect(stillWorks.status).toBe(200);
  });

  it("C) cambiar la contraseña revoca las demás sesiones activas", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headersA = await getSessionHeadersFor(actor.email, password);
    await getSessionHeadersFor(actor.email, password); // segunda sesión, "otro dispositivo"

    const sessionsBefore = await prisma.session.count({ where: { userId: actor.id } });
    expect(sessionsBefore).toBeGreaterThanOrEqual(2);

    const newPassword = "ContraseñaTrasCambio2026";
    await changeOwnPassword(actor, { currentPassword: password, newPassword, confirmPassword: newPassword }, headersA);

    const sessionsAfter = await prisma.session.count({ where: { userId: actor.id } });
    expect(sessionsAfter).toBeLessThan(sessionsBefore);
  });

  it("D) envía un correo de confirmación y audita el cambio sin exponer la contraseña", async () => {
    setEmailTransportForTests(recordingTransport());
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const newPassword = "ContraseñaConfirmacion2026";

    await changeOwnPassword(actor, { currentPassword: password, newPassword, confirmPassword: newPassword }, headers);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(actor.email);

    const events = await prisma.auditEvent.findMany({ where: { entityId: actor.id, action: "USER_PASSWORD_SELF_CHANGED" } });
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(newPassword);
  });

  it("E) rate limiting: intentos excesivos se rechazan", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);

    let rateLimited = false;
    for (let i = 0; i < 8; i++) {
      try {
        await changeOwnPassword(actor, { currentPassword: "SiempreIncorrecta", newPassword: "Intento12345678", confirmPassword: "Intento12345678" }, headers);
      } catch (error) {
        if ((error as Error).message.includes("Demasiados intentos")) {
          rateLimited = true;
          break;
        }
      }
    }
    expect(rateLimited).toBe(true);
  });
});

describe("account-security.service — cambio de correo (autoservicio, dos pasos)", () => {
  it("F) solicitar el cambio exige la contraseña actual correcta", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);

    await expect(
      requestEmailChange(actor, { currentPassword: "Incorrecta", newEmail: uniqueEmail("nuevo") }, headers)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("G) el correo NO cambia de inmediato — solo se envía la verificación a la dirección nueva", async () => {
    setEmailTransportForTests(recordingTransport());
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const newEmail = uniqueEmail("pendiente-confirmar");

    const result = await requestEmailChange(actor, { currentPassword: password, newEmail }, headers);
    expect(result.success).toBe(true);

    const stillOld = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stillOld.email).toBe(actor.email);

    // Dos correos: aviso a la dirección ANTERIOR + verificación a la NUEVA.
    expect(sentEmails).toHaveLength(2);
    const toOld = sentEmails.find((m) => m.to === actor.email);
    const toNew = sentEmails.find((m) => m.to === newEmail);
    expect(toOld).toBeDefined();
    expect(toNew).toBeDefined();
  });

  it("H) no permite solicitar un correo que ya pertenece a otra cuenta", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const other = await makeActiveUser("OtraContraseña2026");
    const headers = await getSessionHeadersFor(actor.email, password);

    await expect(
      requestEmailChange(actor, { currentPassword: password, newEmail: other.email }, headers)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("I) audita la solicitud sin exponer la contraseña", async () => {
    setEmailTransportForTests(recordingTransport());
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const newEmail = uniqueEmail("auditar-cambio");

    await requestEmailChange(actor, { currentPassword: password, newEmail }, headers);

    const events = await prisma.auditEvent.findMany({ where: { entityId: actor.id, action: "USER_EMAIL_CHANGE_REQUESTED" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(password);
  });

  it("J) rate limiting: solicitudes excesivas se rechazan", async () => {
    const password = "ContraseñaOriginal2026";
    const actor = await makeActiveUser(password);
    const headers = await getSessionHeadersFor(actor.email, password);

    let rateLimited = false;
    for (let i = 0; i < 8; i++) {
      try {
        await requestEmailChange(actor, { currentPassword: password, newEmail: uniqueEmail(`rl-${i}`) }, headers);
      } catch (error) {
        if ((error as Error).message.includes("Demasiados intentos")) {
          rateLimited = true;
          break;
        }
      }
    }
    expect(rateLimited).toBe(true);
  });
});
