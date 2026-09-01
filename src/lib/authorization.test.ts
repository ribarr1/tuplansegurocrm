import { describe, it, expect, afterAll } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireSessionUser } from "@/lib/authorization";

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
