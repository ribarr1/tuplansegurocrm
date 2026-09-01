import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUser, setUserActive, listAllUsers } from "@/services/users.service";
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
});
