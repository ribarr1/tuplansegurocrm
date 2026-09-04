import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  userIdSchema,
  agentLicenseIdSchema,
  createAgentLicenseSchema,
  updateAgentLicenseSchema,
} from "@/schemas/agent-compliance.schema";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Licencias de agente — Fase 025 (Parte G).
//
// AgentLicense es la autorización legal GENÉRICA para operar en un
// estado — NO implica ningún contrato con ningún carrier (ver
// AgentCarrierContract, agent-carrier-contracts.service.ts, y
// docs/DECISIONS.md). Simple fila de estado actual, no versionada.
//
// Autorización: ADMIN administra (crear/activar/desactivar) las
// licencias de cualquier usuario. AGENT puede ver únicamente las
// propias, nunca las de otro agente ni modificarlas. ASSISTANT no
// tiene acceso (información de cumplimiento/legal del agente, no
// operativa de clientes).
// ---------------------------------------------------------------------------

const licenseSelect = {
  id: true,
  userId: true,
  state: true,
  status: true,
  licenseNumber: true,
  effectiveDate: true,
  expirationDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentLicenseSelect;

const LICENSE_AUDIT_FIELDS = ["status", "licenseNumber", "effectiveDate", "expirationDate"] as const;

function assertCanView(actor: AuthorizedUser, userId: string) {
  if (actor.role === "ADMIN") return;
  if (actor.role === "AGENT" && actor.id === userId) return;
  throw new AppError("FORBIDDEN", "No tienes acceso a las licencias de este usuario.");
}

function assertAdminOnly(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar licencias de agente.");
  }
}

export async function listAgentLicenses(actor: AuthorizedUser, rawUserId: unknown) {
  const userId = parseOrThrow(userIdSchema, rawUserId);
  assertCanView(actor, userId);
  return prisma.agentLicense.findMany({
    where: { userId },
    select: licenseSelect,
    orderBy: { state: "asc" },
  });
}

export async function createAgentLicense(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createAgentLicenseSchema, rawInput);

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.agentLicense.create({
        data: {
          userId: input.userId,
          state: input.state,
          status: input.status,
          licenseNumber: input.licenseNumber,
          effectiveDate: input.effectiveDate,
          expirationDate: input.expirationDate,
        },
        select: licenseSelect,
      });
      await recordAuditEvent(tx, {
        actor,
        entityType: "AgentLicense",
        entityId: created.id,
        action: "AGENT_LICENSE_CREATE",
        summary: `Licencia de agente creada (${input.state})`,
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Este usuario ya tiene una licencia registrada para ese estado.");
    }
    throw error;
  }
}

export async function updateAgentLicense(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(agentLicenseIdSchema, rawId);
  const input = parseOrThrow(updateAgentLicenseSchema, rawInput);

  const existing = await prisma.agentLicense.findUnique({ where: { id }, select: licenseSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Licencia no encontrada.");

  const data: Prisma.AgentLicenseUpdateInput = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.licenseNumber !== undefined) data.licenseNumber = input.licenseNumber;
  if (input.effectiveDate !== undefined) data.effectiveDate = input.effectiveDate;
  if (input.expirationDate !== undefined) data.expirationDate = input.expirationDate;

  const changes = buildDiff(existing, { ...input, ...data }, LICENSE_AUDIT_FIELDS);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.agentLicense.update({ where: { id }, data, select: licenseSelect });
    if (changes) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "AgentLicense",
        entityId: id,
        action: "AGENT_LICENSE_UPDATE",
        summary: `Licencia de agente actualizada (${existing.state})`,
        changes,
      });
    }
    return updated;
  });
}
