import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestPasswordReset } from "@/services/password-recovery.service";
import { setEmailTransportForTests, createNoopEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { createUser } from "@/services/users.service";
import { activateAccount } from "@/services/user-invitations.service";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — "Olvidé mi contraseña", envoltura de elegibilidad +
// rate limiting sobre el endpoint NATIVO de Better Auth (ver
// password-recovery.service.ts para el porqué). El flujo nativo en sí
// (generación/expiración/consumo de token) ya está cubierto en
// user-invitations.service.test.ts (K-N) — aquí solo se prueba lo que
// ESTA capa agrega.
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

function extractUrlFromMessage(message: EmailMessage): string {
  const match = /https?:\/\/[^\s"<]+/.exec(message.html);
  if (!match) throw new Error("no URL found in test email");
  return match[0].replace(/&amp;/g, "&");
}
function extractToken(url: string): string {
  return new URL(url).searchParams.get("token")!;
}

async function makeActor(role: "ADMIN", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: { name: `${label} Test`, email: `${label.toLowerCase()}.${Date.now()}@test.local`, role, isActive: true, activatedAt: new Date() },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

let admin: AuthorizedUser;
const headers = () => new Headers({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` });

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-recovery");
});

afterEach(() => {
  sentEmails = [];
  setEmailTransportForTests(recordingTransport());
});

afterAll(async () => {
  setEmailTransportForTests(createNoopEmailTransportForTests());
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.verification.deleteMany({
    where: { OR: [{ identifier: { in: createdUserIds.map((id) => `invite:${id}`) } }, { value: { in: createdUserIds } }] },
  });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("password-recovery.service — elegibilidad y rate limiting sobre el flujo nativo", () => {
  it("A) correo inexistente produce la misma respuesta genérica que uno existente", async () => {
    const result = await requestPasswordReset(`no-existe-${Date.now()}@test.local`, headers());
    expect(result.status).toBe("sent");
    expect(sentEmails).toHaveLength(0);
  });

  it("B) usuario ACTIVO y ya ACTIVADO recibe el correo de reset", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Recovery Activo", email: `recov-active.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: "ContraseñaInicial2026", confirmPassword: "ContraseñaInicial2026" });
    sentEmails = [];

    const result = await requestPasswordReset(user.email, headers());
    expect(result.status).toBe("sent");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(user.email);
  });

  it("C) usuario PENDIENTE de activación (nunca activó su cuenta) NO recibe el correo, misma respuesta genérica", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Recovery Pendiente", email: `recov-pending.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    sentEmails = []; // descarta el correo de invitación, no relevante aquí

    const result = await requestPasswordReset(user.email, headers());
    expect(result.status).toBe("sent"); // respuesta EXTERNA idéntica
    expect(sentEmails).toHaveLength(0); // pero NUNCA se envía de verdad
  });

  it("D) usuario INACTIVO (deshabilitado) NO recibe el correo, misma respuesta genérica", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Recovery Inactivo", email: `recov-inactive.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: "ContraseñaInicial2026", confirmPassword: "ContraseñaInicial2026" });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    sentEmails = [];

    const result = await requestPasswordReset(user.email, headers());
    expect(result.status).toBe("sent");
    expect(sentEmails).toHaveLength(0);
  });

  it("E) normaliza el correo (mayúsculas/espacios) antes de buscar al usuario", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Recovery Normaliza", email: `recov-norm.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: "ContraseñaInicial2026", confirmPassword: "ContraseñaInicial2026" });
    sentEmails = [];

    const shouted = `  ${user.email.toUpperCase()}  `;
    const result = await requestPasswordReset(shouted, headers());
    expect(result.status).toBe("sent");
    expect(sentEmails).toHaveLength(1);
  });

  it("F) rate limiting por correo: solicitudes excesivas al MISMO correo se marcan como limitadas, nunca envían de más", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Recovery RateLimit", email: `recov-rate.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: "ContraseñaInicial2026", confirmPassword: "ContraseñaInicial2026" });
    sentEmails = [];

    let rateLimited = false;
    for (let i = 0; i < 8; i++) {
      const result = await requestPasswordReset(user.email, headers());
      if (result.status === "rate_limited") {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
    expect(sentEmails.length).toBeLessThanOrEqual(5);
  });
});
