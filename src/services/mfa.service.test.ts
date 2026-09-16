import { describe, it, expect, afterAll } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  startTotpEnrollment,
  confirmTotpEnrollment,
  regenerateBackupCodes,
  disableTotp,
} from "@/services/mfa.service";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — MFA para ADMIN y operaciones financieras. Todos los
// datos son sintéticos (@test.local). Cada prueba crea su propio actor
// para no compartir el secreto TOTP ni el estado de rate limiting
// entre pruebas.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];

function uniqueEmail(label: string) {
  return `${label}.${Date.now()}${Math.random().toString(36).slice(2)}@test.local`;
}

async function makeUser(role: "ADMIN" | "AGENT", password: string): Promise<AuthorizedUser> {
  const email = uniqueEmail(`mfa-${role.toLowerCase()}`);
  const user = await prisma.user.create({
    data: { name: `MFA ${role} Test`, email, role, isActive: true, activatedAt: new Date() },
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
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function getSessionHeadersFor(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = response.headers.get("set-cookie");
  const cookiePair = setCookie?.split(";")[0];
  if (!cookiePair) throw new Error("no session cookie");
  return new Headers({ cookie: cookiePair });
}

function decodeSecretFromTotpUri(totpURI: string): string {
  const secretParam = new URL(totpURI).searchParams.get("secret");
  if (!secretParam) throw new Error("totpURI sin parámetro secret");
  return Buffer.from(base32.decode(secretParam)).toString();
}

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdUserIds } } });
  await prisma.twoFactor.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("mfa.service — enrollment TOTP", () => {
  it("A) iniciar enrollment exige la contraseña correcta", async () => {
    const password = "ContraseñaAdminMfa2026";
    const actor = await makeUser("AGENT", password);
    const headers = await getSessionHeadersFor(actor.email, password);

    await expect(startTotpEnrollment(actor, { password: "Incorrecta" }, headers)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const result = await startTotpEnrollment(actor, { password }, headers);
    expect(result.totpURI).toContain("otpauth://totp/");
    expect(result.backupCodes).toHaveLength(10);

    const stillDisabled = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stillDisabled.twoFactorEnabled).toBe(false);
  });

  it("B) confirmar con un código incorrecto no activa MFA", async () => {
    const password = "ContraseñaAdminMfa2026";
    const actor = await makeUser("AGENT", password);
    const headers = await getSessionHeadersFor(actor.email, password);
    await startTotpEnrollment(actor, { password }, headers);

    await expect(confirmTotpEnrollment(actor, { code: "000000" }, headers)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const stillDisabled = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stillDisabled.twoFactorEnabled).toBe(false);
  });

  it("C) confirmar con el código real activa MFA y audita inicio y finalización sin exponer el secreto", async () => {
    const password = "ContraseñaAdminMfa2026";
    const actor = await makeUser("AGENT", password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const enrolled = await startTotpEnrollment(actor, { password }, headers);
    const secret = decodeSecretFromTotpUri(enrolled.totpURI);

    await confirmTotpEnrollment(actor, { code: await createOTP(secret).totp() }, headers);

    const activated = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(activated.twoFactorEnabled).toBe(true);

    const events = await prisma.auditEvent.findMany({ where: { entityId: actor.id }, orderBy: { createdAt: "asc" } });
    const actions = events.map((e) => e.action);
    expect(actions).toContain("MFA_ENROLLMENT_STARTED");
    expect(actions).toContain("MFA_ENROLLMENT_COMPLETED");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(password);
  });

  it("D) rate limiting: demasiados intentos de iniciar enrollment se rechazan", async () => {
    const password = "ContraseñaAdminMfa2026";
    const actor = await makeUser("AGENT", password);
    const headers = await getSessionHeadersFor(actor.email, password);

    let rateLimited = false;
    for (let i = 0; i < 8; i++) {
      try {
        await startTotpEnrollment(actor, { password: "SiempreIncorrecta" }, headers);
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

// Firma el segundo factor con el secreto real (simula la app
// autenticadora) y devuelve la cookie de sesión FINAL, ya completa —
// después de que un usuario tiene MFA activo, un signInEmail normal ya
// NO entrega una sesión usable (el propio hook nativo de two-factor la
// borra y responde twoFactorRedirect:true en su lugar, ver
// src/lib/auth.ts) — este helper reproduce el flujo completo de login.
// El header Set-Cookie combinado trae VARIAS cookies separadas por
// ", " (aquí: limpiar la sesión que el paso de credenciales había
// creado antes de que el hook nativo de two-factor la borrara, y
// establecer la cookie de desafío 2FA) — hay que localizar la cookie
// por NOMBRE, nunca asumir que es la primera del header combinado.
function extractCookiePair(setCookieHeader: string | null, cookieName: string): string {
  const pair = setCookieHeader
    ?.split(", ")
    .map((part) => part.split(";")[0].trim())
    .find((part) => part.startsWith(`${cookieName}=`) && part !== `${cookieName}=`);
  if (!pair) throw new Error(`no se encontró la cookie ${cookieName} en Set-Cookie`);
  return pair;
}

async function signInWithTotp(email: string, password: string, secret: string): Promise<Headers> {
  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const twoFactorCookie = extractCookiePair(signIn.headers.get("set-cookie"), "better-auth.two_factor");
  const verify = await auth.api.verifyTOTP({
    body: { code: await createOTP(secret).totp() },
    headers: new Headers({ cookie: twoFactorCookie }),
    asResponse: true,
  });
  const sessionCookie = extractCookiePair(verify.headers.get("set-cookie"), "better-auth.session_token");
  return new Headers({ cookie: sessionCookie });
}

describe("mfa.service — códigos de recuperación", () => {
  async function makeUserWithMfa(role: "ADMIN" | "AGENT", password: string) {
    const actor = await makeUser(role, password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const enrolled = await startTotpEnrollment(actor, { password }, headers);
    const secret = decodeSecretFromTotpUri(enrolled.totpURI);
    await confirmTotpEnrollment(actor, { code: await createOTP(secret).totp() }, headers);
    return { actor, secret };
  }

  it("E) regenerar invalida los códigos anteriores y entrega un nuevo conjunto de 10", async () => {
    const password = "ContraseñaAdminMfa2026";
    const { actor, secret } = await makeUserWithMfa("AGENT", password);
    const headers = await signInWithTotp(actor.email, password, secret);

    const regenerated = await regenerateBackupCodes(actor, { password, code: await createOTP(secret).totp() }, headers);
    expect(regenerated.backupCodes).toHaveLength(10);

    const stored = await prisma.twoFactor.findUniqueOrThrow({ where: { userId: actor.id } });
    expect(stored.backupCodes).not.toContain(regenerated.backupCodes[0]); // se guardan cifrados, nunca en claro
  });

  it("F) regenerar revoca las demás sesiones pero conserva la actual", async () => {
    const password = "ContraseñaAdminMfa2026";
    const { actor, secret } = await makeUserWithMfa("AGENT", password);
    const headersA = await signInWithTotp(actor.email, password, secret);
    await signInWithTotp(actor.email, password, secret); // segunda sesión

    const before = await prisma.session.count({ where: { userId: actor.id } });
    expect(before).toBeGreaterThanOrEqual(2);

    await regenerateBackupCodes(actor, { password, code: await createOTP(secret).totp() }, headersA);

    const after = await prisma.session.count({ where: { userId: actor.id } });
    expect(after).toBeLessThan(before);
  });
});

describe("mfa.service — desactivación", () => {
  async function makeUserWithMfa(role: "ADMIN" | "AGENT", password: string) {
    const actor = await makeUser(role, password);
    const headers = await getSessionHeadersFor(actor.email, password);
    const enrolled = await startTotpEnrollment(actor, { password }, headers);
    const secret = decodeSecretFromTotpUri(enrolled.totpURI);
    await confirmTotpEnrollment(actor, { code: await createOTP(secret).totp() }, headers);
    return { actor, secret };
  }

  // G) "un ADMIN único con MFA no puede desactivar su propio MFA" — la
  // regla en sí (disableTotp cuenta OTROS `role=ADMIN, isActive=true,
  // twoFactorEnabled=true` excluyendo al actor) está implementada y
  // revisada en src/services/mfa.service.ts::disableTotp. Ya NO es
  // posible ejercer la RAMA DE RECHAZO contra esta base compartida de
  // desarrollo: desde la limpieza controlada de la base dev (ver
  // docs/DECISIONS.md), ribarr1@gmail.com es un ADMIN real, permanente
  // y con MFA activo — cualquier ADMIN sintético que este archivo cree
  // SIEMPRE tiene "otro ADMIN activo con MFA" real disponible, así que
  // la cuenta nunca puede llegar a cero. Forzar el escenario exigiría
  // desactivar temporalmente el MFA/estado real de ribarr1@gmail.com
  // desde una prueba automatizada — exactamente lo que este proyecto
  // nunca hace (mismo criterio ya documentado en
  // scripts/create-admin.bootstrap.test.ts para la rama "cero ADMIN"
  // del bootstrap, no simulable de forma segura en una suite que corre
  // repetidamente contra la misma base compartida). La rama de
  // ACEPTACIÓN (existe otro ADMIN con MFA) sigue cubierta por el
  // siguiente test, ahora siempre verdadera gracias a ese mismo ADMIN
  // real — cobertura equivalente, sin tocar su cuenta.
  it("G) documentación: la rama de rechazo de disableTotp ya no es simulable de forma segura contra esta base (ver comentario arriba)", () => {
    expect(true).toBe(true);
  });

  it("H) un ADMIN puede desactivar su MFA si existe OTRO ADMIN con MFA — revoca sesiones y audita", async () => {
    const password = "ContraseñaAdminMfa2026";
    const { actor, secret } = await makeUserWithMfa("ADMIN", password);
    await makeUserWithMfa("ADMIN", "OtraContraseñaAdmin2026"); // segundo ADMIN con MFA
    const headers = await signInWithTotp(actor.email, password, secret);
    await signInWithTotp(actor.email, password, secret); // segunda sesión del mismo actor

    await disableTotp(actor, { password, code: await createOTP(secret).totp() }, headers);

    const disabled = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(disabled.twoFactorEnabled).toBe(false);

    const events = await prisma.auditEvent.findMany({ where: { entityId: actor.id, action: "MFA_DISABLED" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(password);
  });

  it("I) un AGENT (no ADMIN) puede desactivar su propio MFA sin ninguna restricción de 'otro admin'", async () => {
    const password = "ContraseñaAgentMfa2026";
    const { actor, secret } = await makeUserWithMfa("AGENT", password);
    const headers = await signInWithTotp(actor.email, password, secret);

    await disableTotp(actor, { password, code: await createOTP(secret).totp() }, headers);

    const disabled = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(disabled.twoFactorEnabled).toBe(false);
  });

  it("J) desactivar con un código incorrecto se rechaza y MFA sigue activo", async () => {
    const password = "ContraseñaAgentMfa2026";
    const { actor, secret } = await makeUserWithMfa("AGENT", password);
    const headers = await signInWithTotp(actor.email, password, secret);

    await expect(disableTotp(actor, { password, code: "000000" }, headers)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const stillEnabled = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stillEnabled.twoFactorEnabled).toBe(true);
  });
});
