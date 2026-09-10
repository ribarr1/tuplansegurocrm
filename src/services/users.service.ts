import "server-only";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  userIdSchema,
  createUserSchema,
  setUserActiveSchema,
  setUserIsAgentSchema,
  resetUserPasswordSchema,
} from "@/schemas/user.schema";
import { recordAuditEvent } from "@/services/audit.service";
import { issueInvitationToken, sendInvitationEmail } from "@/services/user-invitations.service";

// Solo para uso administrativo (ej. selector de "agente asignado" al
// crear/editar un contacto, o "responsable" al crear/editar una tarea
// — Fase 014, donde ASSISTANT también necesita esta lista para poder
// asignar tareas a agentes). No expone email ni otros campos.
//
// Fase 025.4 (UAT-03/07): filtra por `isAgent`, NUNCA por `role`. Un
// ADMIN que también es agente (ej. el dueño de la agencia) debe
// aparecer aquí igual que cualquier User con role=AGENT — `role` es
// autorización, `isAgent` es la condición de negocio real. Ver
// docs/DECISIONS.md.
export async function listActiveAgents(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN" && actor.role !== "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes permiso para consultar la lista de agentes.");
  }
  return prisma.user.findMany({
    where: { isAgent: true, isActive: true },
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
  isAgent: true,
  activatedAt: true,
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

// CORRECCIÓN (activación de usuarios): el ADMIN NUNCA define ni conoce
// la contraseña de un usuario nuevo — el signup público de Better Auth
// está deshabilitado (emailAndPassword.disableSignUp en auth.ts), así
// que la creación de usuarios sigue sin pasar por auth.api.signUpEmail
// (esa ruta también quedaría bloqueada); en su lugar se crean
// directamente el User y el Account (misma convención que usa Better
// Auth: issuer/providerId "credential") dentro de una transacción,
// pero el Account se crea SIN contraseña (`password: null`) — no hay
// ninguna credencial válida hasta que el propio usuario complete la
// invitación (ver user-invitations.service.ts). La cuenta queda
// `activatedAt: null` ("pendiente de activación") hasta ese momento.
export async function createUser(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createUserSchema, rawInput);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new AppError("VALIDATION_ERROR", "email: Ya existe un usuario con este correo.");

  const { created, rawToken } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        isActive: true,
        activatedAt: null,
        // Fase 025.4: AGENT siempre implica isAgent=true (mismo
        // criterio del backfill de la migración 017); para ADMIN/
        // ASSISTANT se respeta el checkbox explícito del formulario,
        // nunca se asume.
        isAgent: input.role === "AGENT" ? true : input.isAgent,
      },
      select: userSelect,
    });
    await tx.account.create({
      data: {
        issuer: "local:credential",
        providerId: "credential",
        accountId: createdUser.id,
        userId: createdUser.id,
        password: null,
      },
    });
    const token = await issueInvitationToken(tx, createdUser.id);
    // Nunca la contraseña, el token ni el enlace de invitación en el
    // audit log — ver docs/SECURITY.md.
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: createdUser.id,
      action: "USER_CREATE",
      summary: `Usuario creado: ${createdUser.name} (${createdUser.role}) — invitación generada`,
    });
    return { created: createdUser, rawToken: token };
  });

  // El envío del correo ocurre DESPUÉS de confirmar la transacción —
  // nunca una llamada de red dentro de una transacción de DB. Si falla
  // (proveedor no configurado, error externo), el usuario y el token
  // YA quedaron creados: el ADMIN puede usar "Reenviar invitación" en
  // cuanto el correo esté configurado, sin volver a crear el usuario.
  try {
    await sendInvitationEmail({ userId: created.id, name: created.name, email: created.email, rawToken });
  } catch (error) {
    const reason = error instanceof AppError ? error.message : "Error desconocido al enviar el correo.";
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      `El usuario ${created.name} se creó, pero no se pudo enviar la invitación por correo: ${reason} Usa "Reenviar invitación" una vez resuelto.`
    );
  }

  return { user: created };
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

// Fase 025.4 (UAT-03/07): "¿Este usuario también es agente?" —
// independiente de `role`. Un AGENT SIEMPRE es agente (no tiene
// sentido desmarcarlo sin cambiar su rol primero) — se rechaza
// explícitamente para evitar un estado inconsistente (role=AGENT,
// isAgent=false) que rompería el resto del sistema en silencio.
export async function setUserIsAgent(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(setUserIsAgentSchema, rawInput);

  const target = await prisma.user.findUnique({
    where: { id: input.id },
    select: { id: true, name: true, role: true, isAgent: true },
  });
  if (!target) throw new AppError("NOT_FOUND", "Usuario no encontrado.");

  if (target.role === "AGENT" && !input.isAgent) {
    throw new AppError(
      "VALIDATION_ERROR",
      "isAgent: Un usuario con rol Agente siempre es agente — cambia primero su rol si ya no debe serlo."
    );
  }

  if (target.isAgent === input.isAgent) return target;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.id },
      data: { isAgent: input.isAgent },
      select: userSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "User",
      entityId: input.id,
      action: input.isAgent ? "USER_MARKED_AGENT" : "USER_UNMARKED_AGENT",
      summary: input.isAgent
        ? `${updated.name} marcado como agente (independiente de su rol)`
        : `${updated.name} ya no está marcado como agente`,
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
