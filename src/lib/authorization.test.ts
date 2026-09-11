import { describe, it, expect, afterAll } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireSessionUser, requireSessionRole } from "@/lib/authorization";

// L) Un usuario desactivado (isActive=false) no puede llamar servicios
// protegidos, aunque su cookie de sesión siga siendo técnicamente
// válida. Esta es la misma garantía verificada manualmente en la
// Fase 007 (Prueba G), aquí como prueba automatizada de la capa que
// la sostiene: getSessionUser()/requireSessionUser() vuelven a
// consultar Prisma en cada llamada, no confían en la sesión cacheada.
describe("authorization — usuario inactivo", () => {
  let userId: string | undefined;

  afterAll(async () => {
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("L) isActive=false bloquea getSessionUser/requireSessionUser con la misma sesión", async () => {
    const email = `inactive.${Date.now()}@test.local`;
    const password = "PasswordDePruebaSegura123";

    // El signup público está deshabilitado (disableSignUp en auth.ts),
    // así que el usuario de prueba se crea directamente igual que
    // users.service.ts::createUser — User + Account con la misma
    // convención de hash que usa Better Auth.
    const created = await prisma.user.create({
      data: { name: "Inactive Test", email, role: "AGENT", isActive: true },
    });
    userId = created.id;
    await prisma.account.create({
      data: {
        issuer: "local:credential",
        providerId: "credential",
        accountId: created.id,
        userId: created.id,
        password: await hashPassword(password),
      },
    });

    const signInResponse = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const setCookie = signInResponse.headers.get("set-cookie");
    const cookiePair = setCookie?.split(";")[0];
    if (!cookiePair) throw new Error("No se obtuvo cookie de sesión");
    const sessionHeaders = new Headers({ cookie: cookiePair });

    // Sesión válida + usuario activo: debe resolver.
    const activeUser = await getSessionUser(sessionHeaders);
    expect(activeUser?.id).toBe(userId);

    // Desactivar sin tocar la sesión (la cookie sigue siendo la misma).
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const blockedUser = await getSessionUser(sessionHeaders);
    expect(blockedUser).toBeNull();

    await expect(requireSessionUser(sessionHeaders)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

// PREPRODUCCIÓN — MFA (Sección 3): "mientras no complete MFA, no puede
// entrar al CRM ni ejecutar acciones administrativas... la validación
// debe existir server-side". Se prueba directamente en la capa que lo
// aplica (requireSessionUser/requireSessionRole) — la variante de
// render (requireUser, con redirect()) no es probable aquí sin el
// runtime de Next, pero comparte exactamente la misma llamada a
// assertMfaCompliant.
describe("authorization — MFA obligatorio para ADMIN", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function makeSessionHeaders(role: "ADMIN" | "AGENT", twoFactorEnabled: boolean): Promise<Headers> {
    const email = `mfa-gate.${role.toLowerCase()}.${Date.now()}${Math.random().toString(36).slice(2)}@test.local`;
    const password = "PasswordDePruebaSegura123";
    const created = await prisma.user.create({
      data: { name: "MFA Gate Test", email, role, isActive: true, activatedAt: new Date(), twoFactorEnabled },
    });
    createdUserIds.push(created.id);
    await prisma.account.create({
      data: {
        issuer: "local:credential",
        providerId: "credential",
        accountId: created.id,
        userId: created.id,
        password: await hashPassword(password),
      },
    });
    const signInResponse = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookiePair = signInResponse.headers.get("set-cookie")?.split(";")[0];
    if (!cookiePair) throw new Error("No se obtuvo cookie de sesión");
    return new Headers({ cookie: cookiePair });
  }

  it("M) un ADMIN sin MFA es rechazado por requireSessionUser con MFA_REQUIRED", async () => {
    const headers = await makeSessionHeaders("ADMIN", false);
    await expect(requireSessionUser(headers)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(requireSessionRole(["ADMIN"], headers)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("N) un ADMIN CON MFA pasa requireSessionUser/requireSessionRole normalmente", async () => {
    // Un ADMIN con twoFactorEnabled=true dispara el desafío 2FA nativo
    // incluso en este test (Better Auth no distingue "de prueba") —
    // hace falta completar un login real con TOTP, no solo email+
    // password, para obtener una sesión genuinamente autenticada.
    const email = `mfa-gate.admin-real.${Date.now()}${Math.random().toString(36).slice(2)}@test.local`;
    const password = "PasswordDePruebaSegura123";
    const created = await prisma.user.create({
      data: { name: "MFA Gate Real Admin", email, role: "ADMIN", isActive: true, activatedAt: new Date() },
    });
    createdUserIds.push(created.id);
    await prisma.account.create({
      data: {
        issuer: "local:credential", providerId: "credential",
        accountId: created.id, userId: created.id, password: await hashPassword(password),
      },
    });
    const initialSignIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const initialCookie = initialSignIn.headers.get("set-cookie")?.split(";")[0];
    if (!initialCookie) throw new Error("no se obtuvo cookie inicial");
    const enabled = await auth.api.enableTwoFactor({
      body: { password, method: "totp" },
      headers: new Headers({ cookie: initialCookie }),
    });
    if (enabled.method !== "totp") throw new Error("enableTwoFactor no devolvió method totp");
    const secretParam = new URL(enabled.totpURI).searchParams.get("secret");
    if (!secretParam) throw new Error("totpURI sin secret");
    const secret = Buffer.from(base32.decode(secretParam)).toString();
    await auth.api.verifyTOTP({ body: { code: await createOTP(secret).totp() }, headers: new Headers({ cookie: initialCookie }) });

    const secondSignIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const setCookie = secondSignIn.headers.get("set-cookie");
    const twoFactorCookie = setCookie
      ?.split(", ")
      .map((part) => part.split(";")[0].trim())
      .find((part) => part.startsWith("better-auth.two_factor=") && part !== "better-auth.two_factor=");
    if (!twoFactorCookie) throw new Error("no se obtuvo la cookie de desafío 2FA");
    const verify = await auth.api.verifyTOTP({
      body: { code: await createOTP(secret).totp() },
      headers: new Headers({ cookie: twoFactorCookie }),
      asResponse: true,
    });
    const sessionCookie = verify.headers
      .get("set-cookie")
      ?.split(", ")
      .map((part) => part.split(";")[0].trim())
      .find((part) => part.startsWith("better-auth.session_token=") && part !== "better-auth.session_token=");
    if (!sessionCookie) throw new Error("no se obtuvo la cookie de sesión final");
    const headers = new Headers({ cookie: sessionCookie });

    const user = await requireSessionUser(headers);
    expect(user.role).toBe("ADMIN");
    const roled = await requireSessionRole(["ADMIN"], headers);
    expect(roled.role).toBe("ADMIN");
  });

  it("O) un AGENT sin MFA NUNCA es bloqueado por este requisito (es exclusivo de ADMIN)", async () => {
    const headers = await makeSessionHeaders("AGENT", false);
    const user = await requireSessionUser(headers);
    expect(user.role).toBe("AGENT");
  });
});
