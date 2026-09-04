import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUser, setUserActive, listAllUsers, resetUserPassword } from "@/services/users.service";
import { auth } from "@/lib/auth";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-users");
  agent = await makeActor("AGENT", "agent-users");
});

afterAll(async () => {
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("users.service", () => {
  it("AH) ADMIN puede crear un usuario ADMIN", async () => {
    const email = `newadmin.${Date.now()}@test.local`;
    const { user, temporaryPassword } = await createUser(admin, { name: "Nuevo Admin", email, role: "ADMIN" });
    createdUserIds.push(user.id);
    expect(user.role).toBe("ADMIN");
    expect(user.isActive).toBe(true);
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(10);

    const account = await prisma.account.findFirst({ where: { userId: user.id } });
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(temporaryPassword);
  });

  it("AI) ADMIN puede crear un usuario AGENT", async () => {
    const email = `newagent.${Date.now()}@test.local`;
    const { user } = await createUser(admin, { name: "Nuevo Agente", email, role: "AGENT" });
    createdUserIds.push(user.id);
    expect(user.role).toBe("AGENT");
  });

  it("AJ) ADMIN puede crear un usuario ASSISTANT", async () => {
    const email = `newassistant.${Date.now()}@test.local`;
    const { user } = await createUser(admin, { name: "Nuevo Asistente", email, role: "ASSISTANT" });
    createdUserIds.push(user.id);
    expect(user.role).toBe("ASSISTANT");
  });

  it("AK) un no-ADMIN no puede administrar usuarios", async () => {
    await expect(
      createUser(agent, { name: "X", email: `x.${Date.now()}@test.local`, role: "AGENT" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAllUsers(agent)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setUserActive(agent, { id: admin.id, isActive: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("AL) no se puede desactivar al único administrador activo", async () => {
    // admin es el único ADMIN activo en este set de datos de prueba
    // (los demás actores creados son AGENT/ASSISTANT).
    const onlyAdmin = await createUser(admin, {
      name: "Admin Solitario",
      email: `soloadmin.${Date.now()}@test.local`,
      role: "ADMIN",
    });
    createdUserIds.push(onlyAdmin.user.id);

    // Desactivar a todos los demás ADMIN activos (incluyendo posibles
    // datos de seed/otras pruebas) excepto onlyAdmin, para dejarlo como
    // el único activo. Se registran los ids afectados para restaurar
    // exactamente ese estado al final y no dejar efectos secundarios en
    // otros datos del sistema.
    const otherActiveAdmins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { not: onlyAdmin.user.id } },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: otherActiveAdmins.map((u) => u.id) } },
      data: { isActive: false },
    });

    await expect(setUserActive(admin, { id: onlyAdmin.user.id, isActive: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    // Restaurar exactamente el estado previo.
    await prisma.user.updateMany({
      where: { id: { in: otherActiveAdmins.map((u) => u.id) } },
      data: { isActive: true },
    });
  });

  it("desactivar un usuario no-ADMIN funciona normalmente", async () => {
    const { user } = await createUser(admin, {
      name: "Agente Desactivable",
      email: `deact.${Date.now()}@test.local`,
      role: "AGENT",
    });
    createdUserIds.push(user.id);

    const updated = await setUserActive(admin, { id: user.id, isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("no se puede crear un usuario con email duplicado", async () => {
    const email = `dup.${Date.now()}@test.local`;
    const first = await createUser(admin, { name: "Uno", email, role: "AGENT" });
    createdUserIds.push(first.user.id);
    await expect(createUser(admin, { name: "Dos", email, role: "AGENT" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  // Fase 022 (Hallazgo #4 de UAT): restablecer contraseña.
  describe("resetUserPassword", () => {
    it("ADMIN cambia la contraseña de otro usuario, la nueva funciona y la anterior deja de funcionar", async () => {
      const email = `resetpw.${Date.now()}@test.local`;
      const { user, temporaryPassword } = await createUser(admin, { name: "Reset PW", email, role: "AGENT" });
      createdUserIds.push(user.id);

      const oldSignIn = await auth.api.signInEmail({
        body: { email, password: temporaryPassword },
        asResponse: true,
      });
      expect(oldSignIn.status).toBe(200);

      const newPassword = "NuevaContraseñaSegura2026";
      await resetUserPassword(admin, { id: user.id, newPassword, confirmPassword: newPassword });

      const oldSignInAfter = await auth.api.signInEmail({
        body: { email, password: temporaryPassword },
        asResponse: true,
      });
      expect(oldSignInAfter.status).not.toBe(200);

      const newSignIn = await auth.api.signInEmail({
        body: { email, password: newPassword },
        asResponse: true,
      });
      expect(newSignIn.status).toBe(200);
    });

    it("restablecer la contraseña invalida las sesiones existentes del usuario", async () => {
      const email = `resetpw-session.${Date.now()}@test.local`;
      const { user, temporaryPassword } = await createUser(admin, { name: "Reset Session", email, role: "AGENT" });
      createdUserIds.push(user.id);
      await auth.api.signInEmail({ body: { email, password: temporaryPassword }, asResponse: true });
      const sessionsBefore = await prisma.session.count({ where: { userId: user.id } });
      expect(sessionsBefore).toBeGreaterThan(0);

      await resetUserPassword(admin, {
        id: user.id,
        newPassword: "OtraContraseñaSegura2026",
        confirmPassword: "OtraContraseñaSegura2026",
      });
      const sessionsAfter = await prisma.session.count({ where: { userId: user.id } });
      expect(sessionsAfter).toBe(0);
    });

    it("rechaza si newPassword y confirmPassword no coinciden", async () => {
      const { user } = await createUser(admin, {
        name: "Mismatch",
        email: `mismatch.${Date.now()}@test.local`,
        role: "AGENT",
      });
      createdUserIds.push(user.id);
      await expect(
        resetUserPassword(admin, { id: user.id, newPassword: "PasswordUno123", confirmPassword: "PasswordDos123" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rechaza una contraseña demasiado corta", async () => {
      const { user } = await createUser(admin, {
        name: "Corta",
        email: `short.${Date.now()}@test.local`,
        role: "AGENT",
      });
      createdUserIds.push(user.id);
      await expect(
        resetUserPassword(admin, { id: user.id, newPassword: "corta", confirmPassword: "corta" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("un no-ADMIN no puede restablecer contraseñas", async () => {
      const { user } = await createUser(admin, {
        name: "Target",
        email: `target.${Date.now()}@test.local`,
        role: "AGENT",
      });
      createdUserIds.push(user.id);
      await expect(
        resetUserPassword(agent, { id: user.id, newPassword: "PasswordValida123", confirmPassword: "PasswordValida123" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("el audit log NUNCA guarda la contraseña, solo el targetUserId", async () => {
      const { user } = await createUser(admin, {
        name: "Audited",
        email: `audited.${Date.now()}@test.local`,
        role: "AGENT",
      });
      createdUserIds.push(user.id);
      const newPassword = "ContraseñaAuditable2026";
      await resetUserPassword(admin, { id: user.id, newPassword, confirmPassword: newPassword });

      const event = await prisma.auditEvent.findFirst({
        where: { entityType: "User", entityId: user.id, action: "USER_PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
      });
      expect(event).toBeTruthy();
      expect(event?.metadata).toMatchObject({ targetUserId: user.id });
      expect(JSON.stringify(event)).not.toContain(newPassword);
    });
  });

  // Fase 022 (Hallazgo #4 de UAT): protección de auto-desactivación.
  describe("protección de auto-desactivación de ADMIN", () => {
    it("un ADMIN no puede desactivarse a sí mismo", async () => {
      const { user } = await createUser(admin, {
        name: "Self Disable",
        email: `selfdisable.${Date.now()}@test.local`,
        role: "ADMIN",
      });
      createdUserIds.push(user.id);
      const selfActor: AuthorizedUser = { ...user };
      await expect(setUserActive(selfActor, { id: selfActor.id, isActive: false })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stillActive.isActive).toBe(true);
    });

    it("un ADMIN sigue pudiendo desactivar a OTRO ADMIN (la protección es solo sobre sí mismo)", async () => {
      const { user } = await createUser(admin, {
        name: "Other Admin",
        email: `otheradmin.${Date.now()}@test.local`,
        role: "ADMIN",
      });
      createdUserIds.push(user.id);
      const updated = await setUserActive(admin, { id: user.id, isActive: false });
      expect(updated.isActive).toBe(false);
    });
  });
});
