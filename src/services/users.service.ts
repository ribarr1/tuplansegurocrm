import "server-only";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  userIdSchema,
  createUserSchema,
  setUserActiveSchema,
  resetUserPasswordSchema,
} from "@/schemas/user.schema";
import { recordAuditEvent } from "@/services/audit.service";

// Solo para uso administrativo (ej. selector de "agente asignado" al
// crear/editar un contacto, o "responsable" al crear/editar una tarea
// — Fase 014, donde ASSISTANT también necesita esta lista para poder
// asignar tareas a agentes). No expone email ni otros campos.
export async function listActiveAgents(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN" && actor.role !== "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes permiso para consultar la lista de agentes.");
  }
  return prisma.user.findMany({
    where: { role: "AGENT", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar usuarios.");
  }
}

// Administración de usuarios — Fase 019.5. AGENT es un User con
// role=AGENT (nunca una entidad separada), así que crear un "agente"
// es simplemente crear un User con ese rol.
export async function listAllUsers(actor: AuthorizedUser) {
  assertAdminOnly(actor);
  return prisma.user.findMany({ select: userSelect, orderBy: { name: "asc" } });
}

function generateTemporaryPassword(): string {
  // 18 bytes -> 24 caracteres base64url, muy por encima del
  // minPasswordLength=10 configurado en auth.ts.
  return randomBytes(18).toString("base64url");
}

// El signup público de Better Auth está deshabilitado
// (emailAndPassword.disableSignUp en auth.ts) para que nadie pueda
// autorregistrarse con acceso real a datos de clientes. Por eso la
// creación de usuarios NO pasa por auth.api.signUpEmail (esa ruta
// también quedaría bloqueada) — en su lugar se crean directamente el
// User y el Account (con la MISMA convención que usa Better Auth:
// issuer/providerId "credential", contraseña hasheada con su propio
// hashPassword) dentro de una transacción.
//
// La contraseña temporal se genera aquí, se hashea antes de guardarse
// (nunca se persiste en texto plano) y se retorna UNA sola vez para
// que el administrador la comparta por un canal seguro fuera de banda.
// Envío de esa contraseña por email queda pendiente (requiere
// infraestructura adicional, ver docs/DECISIONS.md) — el administrador
// la copia y se la entrega manualmente.
export async function createUser(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createUserSchema, rawInput);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new AppError("VALIDATION_ERROR", "email: Ya existe un usuario con este correo.");

  const temporaryPassword = generateTemporaryPassword();
  const hashedPassword = await hashPassword(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: input.name, email: input.email, role: input.role, isActive: true },
      select: userSelect,
    });
    await tx.account.create({
      data: {
        issuer: "local:credential",
        providerId: "credential",
        accountId: created.id,
        userId: created.id,
        password: hashedPassword,
      },
    });
    // Nunca la contraseña (ni el hash) en el audit log — ver
    // docs/SECURITY.md.
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: created.id,
      action: "USER_CREATE",
      summary: `Usuario creado: ${created.name} (${created.role})`,
    });
    return created;
  });

  return { user, temporaryPassword };
}

// Salvaguarda: nunca permitir que el ADMIN activo restante quede
// desactivado — dejaría el CRM sin nadie con acceso administrativo.
// Fase 022 (Hallazgo #4 de UAT): tampoco un ADMIN puede desactivarse a
// SÍ MISMO — aunque no sea el último, evita quedarse fuera de su
// propia sesión activa por accidente (y evita el caso raro de que
// alguien se desactive a sí mismo con la única sesión de administrador
// abierta en ese momento). Validado server-side, nunca solo oculto en
// la UI — rechaza aunque el request se manipule directamente.
export async function setUserActive(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(setUserActiveSchema, rawInput);

  if (!input.isActive && input.id === actor.id) {
    throw new AppError("VALIDATION_ERROR", "No puedes desactivar tu propia cuenta.");
  }

  const target = await prisma.user.findUnique({ where: { id: input.id }, select: { id: true, role: true, isActive: true } });
  if (!target) throw new AppError("NOT_FOUND", "Usuario no encontrado.");

  if (!input.isActive && target.role === "ADMIN" && target.isActive) {
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (activeAdmins <= 1) {
      throw new AppError(
        "VALIDATION_ERROR",
        "No puedes desactivar al único administrador activo — crea u otorga acceso a otro administrador primero."
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.id },
      data: { isActive: input.isActive },
      select: userSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: input.id,
      action: input.isActive ? "USER_ACTIVATE" : "USER_DEACTIVATE",
      summary: input.isActive ? `Usuario activado: ${updated.name}` : `Usuario desactivado: ${updated.name}`,
    });
    return updated;
  });
}

export async function getUserById(actor: AuthorizedUser, rawId: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(userIdSchema, rawId);
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  return user;
}

// Restablecer contraseña — Fase 022 (Hallazgo #4 de UAT). ADMIN-only,
// para CUALQUIER otro usuario (incluido otro ADMIN). Actualiza el
// mismo Account "credential" que crea createUser, con la MISMA función
// de hash (better-auth/crypto::hashPassword) — Better Auth sigue
// siendo la única fuente de verdad de autenticación, esto no
// reinventa ni improvisa el hash, solo reproduce lo que su propio
// endpoint de login espera encontrar. Invalida todas las sesiones
// activas de ese usuario (Session), para que un restablecimiento
// administrativo lo obligue a iniciar sesión de nuevo con la
// contraseña nueva, en vez de dejar una sesión vieja abierta.
// Nunca se guarda la contraseña (ni el hash) en el audit log — solo
// el hecho de que se restableció.
export async function resetUserPassword(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(resetUserPasswordSchema, rawInput);

  const target = await prisma.user.findUnique({ where: { id: input.id }, select: { id: true, name: true } });
  if (!target) throw new AppError("NOT_FOUND", "Usuario no encontrado.");

  const account = await prisma.account.findFirst({
    where: { userId: input.id, providerId: "credential" },
    select: { id: true },
  });
  if (!account) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Este usuario no tiene una credencial de contraseña local que restablecer."
    );
  }

  const hashedPassword = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { password: hashedPassword } });
    await tx.session.deleteMany({ where: { userId: input.id } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: input.id,
      action: "USER_PASSWORD_RESET",
      summary: `Contraseña restablecida para ${target.name}`,
      metadata: { targetUserId: input.id },
    });
  });

  return { success: true as const };
}
