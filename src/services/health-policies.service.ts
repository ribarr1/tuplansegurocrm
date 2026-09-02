import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { assertCanAccessPolicy } from "@/services/policies.service";
import {
  policyIdForHealthSchema,
  createHealthPolicyDetailSchema,
  updateHealthPolicyDetailSchema,
  ASSISTANT_RESTRICTED_HEALTH_FIELDS,
} from "@/schemas/health-policy.schema";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";

// incomeUsed/taxCreditAmount NUNCA se incluyen aquí — son financiero
// personal sensible (ver docs/SECURITY.md); el audit log registra que
// "algo" cambió en el plan de salud, nunca esos dos valores.
const HEALTH_DETAIL_AUDIT_FIELDS = [
  "marketplaceApplicationId",
  "marketplaceState",
  "planNameSnapshot",
  "deductibleIndividual",
  "deductibleFamily",
  "outOfPocketIndividual",
  "outOfPocketFamily",
] as const;

// ---------------------------------------------------------------------------
// Política de acceso — HealthPolicyDetail (V1)
//
// HealthPolicyDetail es una extensión 1:1 de Policy — nunca tiene una
// regla de acceso propia. Ver/crear/editar reutiliza exactamente
// assertCanAccessPolicy (policies.service.ts): ADMIN/ASSISTANT sin
// restricción de asignación; AGENT solo si tiene acceso al titular o a
// algún miembro cubierto.
//
// Dentro de ese acceso, dos campos son información financiera sensible
// del cliente (no del plan): incomeUsed, taxCreditAmount.
//   - ADMIN / AGENT (con acceso a la póliza): ven y pueden modificar
//     todos los campos.
//   - ASSISTANT: NUNCA recibe incomeUsed/taxCreditAmount en la
//     respuesta — se omiten del objeto devuelto, no solo se ocultan en
//     la UI — y el servicio rechaza explícitamente cualquier intento
//     de escribirlos, aunque el request los incluya.
//   El resto de campos (marketplaceApplicationId, marketplaceState,
//   planNameSnapshot, deductibles, out-of-pocket) son datos
//   administrativos/del plan, no financieros personales del cliente —
//   ASSISTANT los lee y escribe sin restricción.
// ---------------------------------------------------------------------------

const healthDetailSelect = {
  id: true,
  policyId: true,
  marketplaceApplicationId: true,
  marketplaceState: true,
  planNameSnapshot: true,
  taxCreditAmount: true,
  incomeUsed: true,
  deductibleIndividual: true,
  deductibleFamily: true,
  outOfPocketIndividual: true,
  outOfPocketFamily: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.HealthPolicyDetailSelect;

type HealthDetail = Prisma.HealthPolicyDetailGetPayload<{ select: typeof healthDetailSelect }>;

function redactForAssistant(
  actor: AuthorizedUser,
  detail: HealthDetail
): HealthDetail | Omit<HealthDetail, "incomeUsed" | "taxCreditAmount"> {
  if (actor.role !== "ASSISTANT") return detail;
  const { incomeUsed, taxCreditAmount, ...rest } = detail;
  void incomeUsed;
  void taxCreditAmount;
  return rest;
}

function assertNoRestrictedFieldsForAssistant(
  actor: AuthorizedUser,
  input: Record<string, unknown>
): void {
  if (actor.role !== "ASSISTANT") return;
  for (const field of ASSISTANT_RESTRICTED_HEALTH_FIELDS) {
    if (input[field] !== undefined) {
      throw new AppError(
        "FORBIDDEN",
        "No tienes permiso para modificar los campos financieros de Marketplace (crédito fiscal / ingreso)."
      );
    }
  }
}

async function loadPolicyForHealth(policyId: string) {
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
      product: { select: { policyType: true } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  return policy;
}

function assertIsHealthPolicy(policyType: string): void {
  if (policyType !== "HEALTH") {
    throw new AppError("VALIDATION_ERROR", "policyId: Esta póliza no es de tipo Salud.");
  }
}

// null (no undefined) significa "esta póliza HEALTH todavía no tiene
// información registrada" — es un estado válido y esperado (una
// póliza PENDING puede no tener todos los datos todavía), no un error.
export async function getHealthPolicyDetail(actor: AuthorizedUser, rawPolicyId: unknown) {
  const policyId = parseOrThrow(policyIdForHealthSchema, rawPolicyId);
  const policy = await loadPolicyForHealth(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  const detail = await prisma.healthPolicyDetail.findUnique({
    where: { policyId },
    select: healthDetailSelect,
  });
  if (!detail) return null;
  return redactForAssistant(actor, detail);
}

export async function createHealthPolicyDetail(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createHealthPolicyDetailSchema, rawInput);
  const policy = await loadPolicyForHealth(input.policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);
  assertIsHealthPolicy(policy.product.policyType);
  assertNoRestrictedFieldsForAssistant(actor, input);

  const { policyId, ...fields } = input;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.healthPolicyDetail.create({
        data: { policyId, ...fields },
        select: healthDetailSelect,
      });
      await recordAuditEvent(tx, {
        actor,
        entityType: "HealthPolicyDetail",
        entityId: result.id,
        action: "HEALTH_UPDATE_HEALTH_DETAILS",
        policyId,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: "Información del plan de salud agregada",
      });
      return result;
    });
    return redactForAssistant(actor, created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "Esta póliza ya tiene información de salud registrada. Edítala en vez de crearla de nuevo."
      );
    }
    throw error;
  }
}

export async function updateHealthPolicyDetail(
  actor: AuthorizedUser,
  rawPolicyId: unknown,
  rawInput: unknown
) {
  const policyId = parseOrThrow(policyIdForHealthSchema, rawPolicyId);
  const input = parseOrThrow(updateHealthPolicyDetailSchema, rawInput);
  const policy = await loadPolicyForHealth(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);
  assertIsHealthPolicy(policy.product.policyType);
  assertNoRestrictedFieldsForAssistant(actor, input);

  const existing = await prisma.healthPolicyDetail.findUnique({
    where: { policyId },
    select: healthDetailSelect,
  });
  if (!existing) {
    throw new AppError(
      "NOT_FOUND",
      "Esta póliza todavía no tiene información de salud registrada."
    );
  }

  const data: Prisma.HealthPolicyDetailUncheckedUpdateInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (data as Record<string, unknown>)[key] = value;
    }
  }

  const changes = buildDiff(existing, input, HEALTH_DETAIL_AUDIT_FIELDS);
  const touchedRestrictedFields = ["incomeUsed", "taxCreditAmount"].some(
    (f) => (input as Record<string, unknown>)[f] !== undefined
  );

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.healthPolicyDetail.update({
      where: { policyId },
      data,
      select: healthDetailSelect,
    });
    if (changes || touchedRestrictedFields) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "HealthPolicyDetail",
        entityId: result.id,
        action: "HEALTH_UPDATE_HEALTH_DETAILS",
        policyId,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: "Información del plan de salud actualizada",
        changes,
      });
    }
    return result;
  });
  return redactForAssistant(actor, updated);
}
