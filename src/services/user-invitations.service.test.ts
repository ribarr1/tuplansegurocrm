import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUser } from "@/services/users.service";
import {
  resendInvitation,
  revokeInvitation,
  activateAccount,
  getInvitationStatuses,
} from "@/services/user-invitations.service";
import { setEmailTransportForTests, createNoopEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { auth } from "@/lib/auth";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// CORRECCIÓN (activación de usuarios) — invitación de un solo uso y
// "olvidé mi contraseña". Todos los usuarios/tokens son sintéticos;
// nunca se hace una llamada de red real a un proveedor de correo (ver
// el transport de prueba instalado abajo).
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

async function makeActor(role: "ADMIN" | "AGENT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
      activatedAt: new Date(), // actor de prueba, no relevante para su propia activación
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

// Extrae el token crudo del enlace de invitación enviado por correo —
// nunca se lee de la base de datos (ahí solo se guarda el hash).
function extractToken(url: string): string {
  return new URL(url).searchParams.get("token")!;
}
function extractUrlFromMessage(message: EmailMessage): string {
  const match = /https?:\/\/[^\s"<]+/.exec(message.html);
  if (!match) throw new Error("no URL found in test email");
  // El href está HTML-escapado (correcto: es un atributo HTML) — un
  // navegador/cliente de correo real decodifica "&amp;" a "&" al leer
  // el href antes de navegar; se replica eso aquí antes de parsear la
  // URL, igual que haría cualquier lector real del enlace.
  return match[0].replace(/&amp;/g, "&");
}

let admin: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-invitations");
});

afterEach(() => {
  sentEmails = [];
  setEmailTransportForTests(recordingTransport());
});

afterAll(async () => {
  setEmailTransportForTests(createNoopEmailTransportForTests());
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  // Limpia tanto las invitaciones (identifier="invite:<userId>") como
  // los tokens de "olvidé mi contraseña" NATIVOS de Better Auth
  // (identifier="reset-password:<token>", value=<userId>) que las
  // pruebas K–N de este archivo generan y no siempre consumen.
  await prisma.verification.deleteMany({
    where: {
      OR: [
        { identifier: { in: createdUserIds.map((id) => `invite:${id}`) } },
        { value: { in: createdUserIds } },
      ],
    },
  });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("user-invitations.service — activación de usuarios nuevos", () => {
  it("A) crear un usuario envía una invitación con un enlace de un solo uso", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Uno", email: `inv1.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(user.email);
    expect(sentEmails[0].subject).toContain("Activa tu cuenta");
    expect(sentEmails[0].html).toContain("/activate");
  });

  it("B) activación válida: establece contraseña, marca activatedAt y permite iniciar sesión", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Dos", email: `inv2.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));

    const newPassword = "ContraseñaNueva2026";
    const result = await activateAccount({ userId: user.id, token, newPassword, confirmPassword: newPassword });
    expect(result.success).toBe(true);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.activatedAt).not.toBeNull();

    const signIn = await auth.api.signInEmail({
      body: { email: user.email, password: newPassword },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
  });

  it("C) token vencido se rechaza (nunca se acepta después de la expiración)", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Vencido", email: `inv3.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));

    // Fuerza la expiración directamente en DB (nunca se espera 24h reales).
    await prisma.verification.updateMany({
      where: { identifier: `invite:${user.id}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      activateAccount({ userId: user.id, token, newPassword: "ContraseñaValida2026", confirmPassword: "ContraseñaValida2026" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("D) token reutilizado se rechaza (un solo uso — se borra al consumirse)", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Reuso", email: `inv4.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));

    const password = "ContraseñaValida2026";
    await activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password });

    await expect(
      activateAccount({ userId: user.id, token, newPassword: "OtraContraseña2026", confirmPassword: "OtraContraseña2026" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("E) reenviar invalida el token anterior — el enlace viejo deja de funcionar, el nuevo sí", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Reenvio", email: `inv5.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const oldToken = extractToken(extractUrlFromMessage(sentEmails[0]));

    await resendInvitation(admin, { userId: user.id });
    expect(sentEmails).toHaveLength(2);
    const newToken = extractToken(extractUrlFromMessage(sentEmails[1]));
    expect(newToken).not.toBe(oldToken);

    const password = "ContraseñaValida2026";
    await expect(
      activateAccount({ userId: user.id, token: oldToken, newPassword: password, confirmPassword: password })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const result = await activateAccount({ userId: user.id, token: newToken, newPassword: password, confirmPassword: password });
    expect(result.success).toBe(true);
  });

  it("F) solo ADMIN puede reenviar una invitación", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Seguridad", email: `inv6.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const agentActor = await makeActor("AGENT", "agent-invitations-noadmin");

    await expect(resendInvitation(agentActor, { userId: user.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("G) reenviar sobre una cuenta ya activada se rechaza", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Activo", email: `inv7.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));
    const password = "ContraseñaValida2026";
    await activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password });

    await expect(resendInvitation(admin, { userId: user.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("H) getInvitationStatuses distingue PENDING/EXPIRED/ACTIVATED correctamente", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user: pendingUser } = await createUser(admin, { name: "Estado Pendiente", email: `inv8.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(pendingUser.id);
    const { user: expiredUser } = await createUser(admin, { name: "Estado Vencido", email: `inv9.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(expiredUser.id);
    await prisma.verification.updateMany({
      where: { identifier: `invite:${expiredUser.id}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { user: activatedUser } = await createUser(admin, { name: "Estado Activo", email: `inv10.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(activatedUser.id);
    const activatedToken = extractToken(extractUrlFromMessage(sentEmails[2]));
    const password = "ContraseñaValida2026";
    await activateAccount({ userId: activatedUser.id, token: activatedToken, newPassword: password, confirmPassword: password });

    const users = await prisma.user.findMany({
      where: { id: { in: [pendingUser.id, expiredUser.id, activatedUser.id] } },
      select: { id: true, activatedAt: true },
    });
    const statuses = await getInvitationStatuses(users);
    expect(statuses.get(pendingUser.id)).toBe("PENDING");
    expect(statuses.get(expiredUser.id)).toBe("EXPIRED");
    expect(statuses.get(activatedUser.id)).toBe("ACTIVATED");
  });

  it("I) rate limiting: reenvíos excesivos del mismo ADMIN se rechazan", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado RateLimit", email: `inv11.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);

    let rejected = false;
    for (let i = 0; i < 8; i++) {
      try {
        await resendInvitation(admin, { userId: user.id });
      } catch (error) {
        rejected = true;
        expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
        break;
      }
    }
    expect(rejected).toBe(true);
  });

  it("J) ningún token ni contraseña aparece en el resumen o metadata de auditoría", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Auditoria", email: `inv12.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));
    const password = "ContraseñaAuditable2026";
    await activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password });

    const events = await prisma.auditEvent.findMany({ where: { entityId: user.id } });
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(password);
  });

  it("K) revocar invalida el enlace pendiente de inmediato, sin emitir uno nuevo", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Revocado", email: `inv13.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));

    await revokeInvitation(admin, { userId: user.id });

    const password = "ContraseñaValida2026";
    await expect(
      activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const statuses = await getInvitationStatuses([{ id: user.id, activatedAt: null }]);
    expect(statuses.get(user.id)).toBe("EXPIRED");
  });

  it("L) revocar es idempotente — revocar de nuevo (o una invitación inexistente) no lanza", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Doble Revocado", email: `inv14.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);

    await revokeInvitation(admin, { userId: user.id });
    await expect(revokeInvitation(admin, { userId: user.id })).resolves.toEqual({ success: true });
  });

  it("M) revocar una cuenta ya activada se rechaza", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Activo Revocar", email: `inv15.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));
    const password = "ContraseñaValida2026";
    await activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password });

    await expect(revokeInvitation(admin, { userId: user.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("N) solo ADMIN puede revocar", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Revocar Seguridad", email: `inv16.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const agentActor = await makeActor("AGENT", "agent-invitations-revoke-noadmin");

    await expect(revokeInvitation(agentActor, { userId: user.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("O) revocación se audita sin exponer el token", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Auditar Revocar", email: `inv17.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));

    await revokeInvitation(admin, { userId: user.id });

    const events = await prisma.auditEvent.findMany({ where: { entityId: user.id, action: "USER_INVITATION_REVOKED" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("P) activar una cuenta pendiente envía un correo de aviso de activación", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "Invitado Aviso", email: `inv18.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const token = extractToken(extractUrlFromMessage(sentEmails[0]));
    const password = "ContraseñaValida2026";

    await activateAccount({ userId: user.id, token, newPassword: password, confirmPassword: password });

    expect(sentEmails).toHaveLength(2); // invitación + aviso de activación
    expect(sentEmails[1].to).toBe(user.email);
    expect(sentEmails[1].subject).toContain("activa");
  });

  it("Q) límite de tasa por IP en activación — muchos intentos desde la misma IP contra distintas invitaciones se rechazan", async () => {
    setEmailTransportForTests(recordingTransport());
    const fakeHeaders = new Headers({ "x-forwarded-for": "203.0.113.77" });
    const users: { id: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const { user } = await createUser(admin, { name: `IP Limit ${i}`, email: `ip-limit-${i}.${Date.now()}@test.local`, role: "AGENT" });
      createdUserIds.push(user.id);
      users.push(user);
    }

    let rejected = false;
    for (let i = 0; i < 35; i++) {
      const target = users[i % users.length];
      try {
        await activateAccount(
          { userId: target.id, token: "wrong-token-on-purpose", newPassword: "ContraseñaValida2026", confirmPassword: "ContraseñaValida2026" },
          fakeHeaders
        );
      } catch (error) {
        if ((error as { code?: string }).code === "VALIDATION_ERROR") {
          // Puede ser "token inválido" (esperado, siempre) o el propio
          // límite de tasa — solo nos interesa detectar que EN ALGÚN
          // punto el límite por IP se activa (mensaje distinto).
          if ((error as Error).message.includes("Demasiados intentos")) {
            rejected = true;
            break;
          }
        }
      }
    }
    expect(rejected).toBe(true);
  });
});

describe("sin registro público — signUpEmail sigue bloqueado incondicionalmente", () => {
  it("R) auth.api.signUpEmail se rechaza sin importar los datos enviados", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Intento De Registro", email: `signup-attempt.${Date.now()}@test.local`, password: "ContraseñaValida2026" },
      asResponse: true,
    });
    expect(response.status).not.toBe(200);
  });
});

describe("olvidé mi contraseña — flujo nativo de Better Auth", () => {
  it("K) correo inexistente produce la MISMA respuesta genérica (nunca revela si existe)", async () => {
    const response = await auth.api.requestPasswordReset({
      body: { email: `no-existe-${Date.now()}@test.local`, redirectTo: "/reset-password" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(true);
  });

  it("L) correo existente produce la misma respuesta genérica y envía un enlace de reset", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "OlvideMiClave", email: `forgot.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    const initialPassword = "ContraseñaInicial2026";
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: initialPassword, confirmPassword: initialPassword });
    sentEmails = [];

    const response = await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: "/reset-password" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(user.email);
  });

  it("M) restablecer con el token del correo funciona y revoca las sesiones existentes", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "ResetNativo", email: `resetnativo.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    const initialPassword = "ContraseñaInicial2026";
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: initialPassword, confirmPassword: initialPassword });

    await auth.api.signInEmail({ body: { email: user.email, password: initialPassword }, asResponse: true });
    const sessionsBefore = await prisma.session.count({ where: { userId: user.id } });
    expect(sessionsBefore).toBeGreaterThan(0);

    sentEmails = [];
    await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: "/reset-password" }, asResponse: true });
    const resetUrl = extractUrlFromMessage(sentEmails[0]);
    const resetToken = new URL(resetUrl).pathname.split("/").pop()!;

    const newPassword = "ContraseñaRestablecida2026";
    const resetResponse = await auth.api.resetPassword({
      body: { newPassword, token: resetToken },
      asResponse: true,
    });
    expect(resetResponse.status).toBe(200);

    const sessionsAfter = await prisma.session.count({ where: { userId: user.id } });
    expect(sessionsAfter).toBe(0);

    const newSignIn = await auth.api.signInEmail({ body: { email: user.email, password: newPassword }, asResponse: true });
    expect(newSignIn.status).toBe(200);
  });

  it("N) un token de reset ya usado se rechaza (un solo uso)", async () => {
    setEmailTransportForTests(recordingTransport());
    const { user } = await createUser(admin, { name: "ResetReuso", email: `resetreuso.${Date.now()}@test.local`, role: "AGENT" });
    createdUserIds.push(user.id);
    const inviteToken = extractToken(extractUrlFromMessage(sentEmails[0]));
    const initialPassword = "ContraseñaInicial2026";
    await activateAccount({ userId: user.id, token: inviteToken, newPassword: initialPassword, confirmPassword: initialPassword });

    sentEmails = [];
    await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: "/reset-password" }, asResponse: true });
    const resetUrl = extractUrlFromMessage(sentEmails[0]);
    const resetToken = new URL(resetUrl).pathname.split("/").pop()!;

    await auth.api.resetPassword({ body: { newPassword: "PrimerCambio2026", token: resetToken }, asResponse: true });
    const secondAttempt = await auth.api.resetPassword({
      body: { newPassword: "SegundoCambio2026", token: resetToken },
      asResponse: true,
    });
    expect(secondAttempt.status).not.toBe(200);
  });
});
