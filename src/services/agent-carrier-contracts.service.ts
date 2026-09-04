import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  userIdSchema,
  agentCarrierContractIdSchema,
  createAgentCarrierContractSchema,
  updateAgentCarrierContractSchema,
} from "@/schemas/agent-compliance.schema";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Contratos carrier/agente — Fase 025 (Parte H).
//
// Un AgentCarrierContract es específico de carrier + estado + TIPO DE
// PÓLIZA — una licencia (AgentLicense) NO implica ningún contrato, y un
// contrato HEALTH con un carrier NO implica un contrato DENTAL con el
// mismo carrier (líneas de negocio distintas en la práctica real de la
// agencia, ver docs/DECISIONS.md). Se persiste una fila por
// (userId, carrierId, state, policyType) — nunca un array opaco de
// estados en una sola fila.
//
// Autorización: igual que AgentLicense — ADMIN administra cualquier
// usuario, AGENT solo ve los propios, ASSISTANT sin acceso.
// ---------------------------------------------------------------------------

const contractSelect = {
  id: true,
  userId: true,
  carrierId: true,
  state: true,
  policyType: true,
  status: true,
  effectiveDate: true,
  terminationDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  carrier: { select: { id: true, name: true } },
} satisfies Prisma.AgentCarrierContractSelect;

const CONTRACT_AUDIT_FIELDS = ["status", "effectiveDate", "terminationDate", "notes"] as const;

function assertCanView(actor: AuthorizedUser, userId: string) {
  if (actor.role === "ADMIN") return;
  if (actor.role === "AGENT" && actor.id === userId) return;
  throw new AppError("FORBIDDEN", "No tienes acceso a los contratos de este usuario.");
}

function assertAdminOnly(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar contratos de agente.");
  }
}

export async function listAgentCarrierContracts(actor: AuthorizedUser, rawUserId: unknown) {
  const userId = parseOrThrow(userIdSchema, rawUserId);
  assertCanView(actor, userId);
  return prisma.agentCarrierContract.findMany({
    where: { userId },
    select: contractSelect,
    orderBy: [{ carrier: { name: "asc" } }, { policyType: "asc" }, { state: "asc" }],
  });
}

// Crea UNA fila por cada estado seleccionado, en una sola transacción
// — si cualquiera ya existe (P2002 en el unique compuesto), toda la
// operación se revierte, nunca queda un subconjunto de estados creado
// a medias.
export async function createAgentCarrierContract(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createAgentCarrierContractSchema, rawInput);

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new AppError("NOT_FOUND", "Usuario no encontrado.");
  const carrier = await prisma.carrier.findUnique({
    where: { id: input.carrierId },
    select: { id: true, name: true, isActive: true },
  });
  if (!carrier) throw new AppError("NOT_FOUND", "Compañía no encontrada.");

  const uniqueStates = Array.from(new Set(input.states));

  try {
    return await prisma.$transaction(async (tx) => {
      const created = [];
      for (const state of uniqueStates) {
        const row = await tx.agentCarrierContract.create({
          data: {
            userId: input.userId,
            carrierId: input.carrierId,
            state,
            policyType: input.policyType,
            status: input.status,
            effectiveDate: input.effectiveDate,
            terminationDate: input.terminationDate,
            notes: input.notes,
          },
          select: contractSelect,
        });
        created.push(row);
        await recordAuditEvent(tx, {
          actor,
          entityType: "AgentCarrierContract",
          entityId: row.id,
          action: "AGENT_CONTRACT_CREATE",
          summary: `Contrato creado: ${carrier.name} / ${input.policyType} / ${state}`,
        });
      }
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "Ya existe un contrato para esta combinación de compañía, tipo de póliza y estado."
      );
    }
    throw error;
  }
}

export async function updateAgentCarrierContract(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(agentCarrierContractIdSchema, rawId);
  const input = parseOrThrow(updateAgentCarrierContractSchema, rawInput);

  const existing = await prisma.agentCarrierContract.findUnique({ where: { id }, select: contractSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Contrato no encontrado.");

  const data: Prisma.AgentCarrierContractUpdateInput = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.effectiveDate !== undefined) data.effectiveDate = input.effectiveDate;
  if (input.terminationDate !== undefined) data.terminationDate = input.terminationDate;
  if (input.notes !== undefined) data.notes = input.notes;

  const changes = buildDiff(existing, { ...input, ...data }, CONTRACT_AUDIT_FIELDS);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.agentCarrierContract.update({ where: { id }, data, select: contractSelect });
    if (changes) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "AgentCarrierContract",
        entityId: id,
        action: "AGENT_CONTRACT_UPDATE",
        summary: `Contrato actualizado: ${existing.carrier.name} / ${existing.policyType} / ${existing.state}`,
        changes,
      });
    }
    return updated;
  });
}
