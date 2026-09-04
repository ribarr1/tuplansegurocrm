import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getTodayBusinessRange } from "@/lib/business-time-core";

// ---------------------------------------------------------------------------
// Núcleo de la reconciliación automática del ciclo de vida de pólizas —
// Fase 025 (Hallazgo #5 de UAT, Parte E). Vive SEPARADO de
// policy-lifecycle.service.ts (que reexporta esto con el guard
// "server-only" encima) por el mismo motivo que pii-crypto-core.ts
// (Fase 021/023): el entrypoint CLI de este job
// (scripts/policy-lifecycle-job.ts) corre como script de Node/tsx
// fuera del árbol de Next, y "server-only" lanza incondicionalmente en
// ese contexto. Por el mismo motivo, este archivo NUNCA importa
// audit.service.ts ni people.service.ts (ambos con el guard) —
// duplica localmente el registro de AuditEvent y el recómputo de
// Prospecto/Cliente vía Prisma directo, mismo criterio ya usado en
// src/import/book-of-business/apply-plan.ts.
//
// Toda la app (Server Components/Actions) debe seguir importando
// policy-lifecycle.service.ts, nunca este archivo directamente, salvo
// el job CLI.
//
// Reglas (usando SIEMPRE el día de negocio de APP_TIME_ZONE, nunca la
// zona horaria del navegador ni la del proceso):
//   PENDING -> ACTIVE  cuando effectiveDate <= businessDate.
//   ACTIVE  -> EXPIRED cuando terminationDate <  businessDate (una
//     póliza con terminationDate = 12/31 sigue ACTIVE el 12/31 mismo,
//     pasa a EXPIRED a partir del 1/1).
//   CANCELLED/EXPIRED NUNCA se reactivan automáticamente — ninguna
//   consulta de este módulo las toca (ni como origen ni como destino).
//
// Idempotencia: cada consulta solo selecciona filas que TODAVÍA están
// en el status de origen (PENDING / ACTIVE respectivamente) — una vez
// aplicado el cambio, la fila deja de coincidir en una corrida
// posterior, así que nunca se genera un segundo AuditEvent para el
// mismo cambio real, sin necesidad de una marca "ya procesado" aparte.
//
// Auditoría: cada cambio automático genera un AuditEvent con actor
// SYSTEM (actorUserId: null, actorType: "SYSTEM") y una acción
// dedicada (POLICY_AUTO_ACTIVATED / POLICY_AUTO_EXPIRED) — nunca
// reutiliza POLICY_STATUS_CHANGE (que implica una acción humana vía
// updatePolicy), para que el historial deje claro que el cambio lo
// hizo el job, no un agente.
// ---------------------------------------------------------------------------

function dateOnlyTimestamp(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

async function recordSystemAuditEvent(
  tx: Prisma.TransactionClient,
  input: {
    entityId: string;
    action: string;
    policyId: string;
    householdId: string | null;
    contactPersonId: string;
    summary: string;
  }
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorUserId: null,
      actorType: "SYSTEM",
      entityType: "Policy",
      entityId: input.entityId,
      action: input.action,
      contactPersonId: input.contactPersonId,
      policyId: input.policyId,
      householdId: input.householdId,
      summary: input.summary,
    },
  });
}

const AUTO_MANAGED_CONTACT_STATUSES = ["PROSPECT", "CLIENT"] as const;

// Duplicado deliberado de people.service.ts::recomputePersonContactStatus
// — ver el comentario de cabecera de este archivo.
async function recomputeContactStatus(tx: Prisma.TransactionClient, personId: string): Promise<void> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: { id: true, contactStatus: true },
  });
  if (!person) return;
  if (!(AUTO_MANAGED_CONTACT_STATUSES as readonly string[]).includes(person.contactStatus)) return;

  const activeCoverage = await tx.policyMember.findFirst({
    where: { personId, policy: { status: "ACTIVE" } },
    select: { id: true },
  });
  const nextStatus = activeCoverage ? "CLIENT" : "PROSPECT";
  if (nextStatus === person.contactStatus) return;

  await tx.person.update({ where: { id: personId }, data: { contactStatus: nextStatus } });
  await tx.auditEvent.create({
    data: {
      actorUserId: null,
      actorType: "SYSTEM",
      entityType: "Person",
      entityId: personId,
      action: "CONTACT_STATUS_CHANGE",
      contactPersonId: personId,
      summary:
        nextStatus === "CLIENT"
          ? "Contacto actualizado automáticamente a Cliente (cobertura activa)"
          : "Contacto actualizado automáticamente a Prospecto (sin cobertura activa)",
      changes: { contactStatus: { before: person.contactStatus, after: nextStatus } },
    },
  });
}

export type PolicyLifecycleResult = {
  businessDate: string; // YYYY-MM-DD, seguro de loguear (nunca PII)
  activatedCount: number;
  expiredCount: number;
};

export async function reconcilePolicyLifecycleCore(
  businessDate?: { year: number; month: number; day: number }
): Promise<PolicyLifecycleResult> {
  const today = businessDate ?? getTodayBusinessRange();
  const todayUtc = dateOnlyTimestamp(today);
  const businessDateStr = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;

  // --- PENDING -> ACTIVE ---
  // effectiveDate NOT NULL es parte del filtro: una PENDING sin
  // effectiveDate todavía no tiene los datos necesarios para ser
  // ACTIVE (ver assertActiveHasEffectiveDate, policies.service.ts) —
  // se deja tal cual, sin loguear ningún dato personal, solo se omite.
  const toActivate = await prisma.policy.findMany({
    where: { status: "PENDING", effectiveDate: { lte: todayUtc } },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      members: { select: { personId: true } },
    },
  });

  let activatedCount = 0;
  for (const policy of toActivate) {
    await prisma.$transaction(async (tx) => {
      await tx.policy.update({ where: { id: policy.id }, data: { status: "ACTIVE" } });
      await recordSystemAuditEvent(tx, {
        entityId: policy.id,
        action: "POLICY_AUTO_ACTIVATED",
        policyId: policy.id,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: "Póliza activada automáticamente (fecha efectiva alcanzada)",
      });
      await recomputeContactStatus(tx, policy.holderId);
      for (const member of policy.members) {
        await recomputeContactStatus(tx, member.personId);
      }
    });
    activatedCount++;
  }

  // --- ACTIVE -> EXPIRED ---
  const toExpire = await prisma.policy.findMany({
    where: { status: "ACTIVE", terminationDate: { lt: todayUtc } },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      members: { select: { personId: true } },
    },
  });

  let expiredCount = 0;
  for (const policy of toExpire) {
    await prisma.$transaction(async (tx) => {
      await tx.policy.update({ where: { id: policy.id }, data: { status: "EXPIRED" } });
      await recordSystemAuditEvent(tx, {
        entityId: policy.id,
        action: "POLICY_AUTO_EXPIRED",
        policyId: policy.id,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: "Póliza expirada automáticamente (fecha de terminación alcanzada)",
      });
      await recomputeContactStatus(tx, policy.holderId);
      for (const member of policy.members) {
        await recomputeContactStatus(tx, member.personId);
      }
    });
    expiredCount++;
  }

  return { businessDate: businessDateStr, activatedCount, expiredCount };
}
