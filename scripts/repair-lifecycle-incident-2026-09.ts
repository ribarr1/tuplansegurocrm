import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getAppTimeZone, getTodayBusinessRange } from "../src/lib/business-time-core";
import { healthDefaultTerminationDate, resolveHealthCoverageYear } from "../src/lib/health-coverage-year";
import { shouldRestoreExpiredPolicyToActive } from "../src/lib/lifecycle-repair";
import type { Prisma } from "../src/generated/prisma/client";

// Fase 025.2 — reparación puntual del incidente real de datos:
//
//   Bug 1: una renovación (b48d17a6...) reutilizó el mismo Product que
//   su predecesora (planYear=2026 desalineado) mientras su propia
//   effectiveDate ya era 2027-01-01 — terminationDate quedó en
//   2026-12-31 (ANTES que su propia effectiveDate).
//
//   Bug 2: policy-lifecycle.service.test.ts llamaba a
//   reconcilePolicyLifecycle con un businessDate futuro SIN acotar la
//   consulta (antes de que existiera el parámetro `policyIds`) — cada
//   corrida de la suite completa reconciliaba la tabla `Policy` REAL
//   completa, expirando prematuramente pólizas HEALTH 2026 genuinas
//   cuyo terminationDate (12/31/2026) todavía no había llegado según
//   el businessDate real (2026-09-04).
//
// Este script NUNCA reactiva:
//   - CANCELLED reales.
//   - EXPIRED sin AuditEvent POLICY_AUTO_EXPIRED (evidencia de que el
//     job automático fue la causa) — esas 2 son las 2025 legítimas.
//   - EXPIRED cuyo terminationDate (ya corregido si aplica) siga
//     siendo anterior al businessDate real — esas SÍ deben quedar
//     EXPIRED.
//
// Idempotente: solo actúa sobre filas que todavía están en el estado
// incorrecto; correrlo de nuevo no repite nada (Paso 1 solo toca
// terminationDate ya corregida si aún no coincide; Paso 2 solo
// reactiva pólizas que siguen EXPIRED).

const AUTO_MANAGED_CONTACT_STATUSES = ["PROSPECT", "CLIENT"] as const;

async function recomputeContactStatus(tx: Prisma.TransactionClient, personId: string): Promise<void> {
  const person = await tx.person.findUnique({ where: { id: personId }, select: { id: true, contactStatus: true } });
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
          ? "Contacto actualizado automáticamente a Cliente (cobertura activa) — tras reparación de incidente Fase 025.2"
          : "Contacto actualizado automáticamente a Prospecto (sin cobertura activa) — tras reparación de incidente Fase 025.2",
      changes: { contactStatus: { before: person.contactStatus, after: nextStatus } },
    },
  });
}

async function main() {
  const tz = getAppTimeZone();
  const businessDate = getTodayBusinessRange();
  const businessDateUtc = new Date(Date.UTC(businessDate.year, businessDate.month - 1, businessDate.day));
  console.log(`APP_TIME_ZONE: ${tz}`);
  console.log(`businessDate: ${businessDate.year}-${String(businessDate.month).padStart(2, "0")}-${String(businessDate.day).padStart(2, "0")}`);

  // ---------------------------------------------------------------
  // PASO 1 — reparar terminationDate incorrectas (Bug 1)
  // ---------------------------------------------------------------
  const allHealthWithDates = await prisma.policy.findMany({
    where: { product: { policyType: "HEALTH" }, effectiveDate: { not: null }, terminationDate: { not: null } },
    select: {
      id: true,
      effectiveDate: true,
      terminationDate: true,
      product: { select: { planYear: true } },
    },
  });

  let repaired2027 = 0;
  let ambiguousDateOrder = 0;
  for (const p of allHealthWithDates) {
    const invalidOrder = p.terminationDate!.getUTCFullYear() < p.effectiveDate!.getUTCFullYear();
    if (!invalidOrder) continue;

    const resolved = resolveHealthCoverageYear(p.product.planYear, p.effectiveDate);
    const correctedTermination = healthDefaultTerminationDate("HEALTH", p.product.planYear, p.effectiveDate);
    if (!correctedTermination || correctedTermination.getTime() <= p.effectiveDate!.getTime()) {
      // No se puede resolver de forma inequívoca -> reportar, nunca adivinar.
      ambiguousDateOrder++;
      console.log(`AMBIGUOUS (no se repara): policy(id only)=${p.id} effectiveDate=${p.effectiveDate!.toISOString().slice(0, 10)} terminationDate=${p.terminationDate!.toISOString().slice(0, 10)} productPlanYear=${p.product.planYear} resolvedSource=${resolved.source}`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.policy.update({ where: { id: p.id }, data: { terminationDate: correctedTermination } });
      await tx.auditEvent.create({
        data: {
          actorUserId: null,
          actorType: "SYSTEM",
          entityType: "Policy",
          entityId: p.id,
          action: "POLICY_STATUS_CORRECTED",
          policyId: p.id,
          summary: `terminationDate corregida (Fase 025.2): tenía un año anterior a su effectiveDate por reutilizar el planYear de un Product de una renovación — recalculada usando el año de cobertura real de esta póliza.`,
          metadata: {
            reason: "invalid_termination_before_effective",
            productPlanYearUsedIncorrectly: p.product.planYear,
            correctedYearSource: resolved.source,
          },
        },
      });
    });
    repaired2027++;
    console.log(`REPARADA: policy(id only)=${p.id} terminationDate -> ${correctedTermination.toISOString().slice(0, 10)}`);
  }

  console.log("---");
  console.log(`terminationDate inválidas reparadas: ${repaired2027}`);
  console.log(`terminationDate inválidas ambiguas (no reparadas): ${ambiguousDateOrder}`);

  // ---------------------------------------------------------------
  // PASO 2 — restaurar pólizas prematuramente EXPIRED (Bug 2)
  // ---------------------------------------------------------------
  const autoExpiredEvents = await prisma.auditEvent.findMany({
    where: { action: "POLICY_AUTO_EXPIRED" },
    select: { id: true, policyId: true },
  });
  const candidatePolicyIds = [...new Set(autoExpiredEvents.map((e) => e.policyId).filter((id): id is string => Boolean(id)))];

  const candidates = await prisma.policy.findMany({
    where: { id: { in: candidatePolicyIds }, status: "EXPIRED" },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      terminationDate: true,
      members: { select: { personId: true } },
    },
  });

  let restored = 0;
  let leftExpiredLegit = 0;
  for (const policy of candidates) {
    // Solo se restaura si, con la terminationDate YA corregida (Paso
    // 1), la póliza en realidad NO debería haber expirado todavía
    // según el businessDate REAL — nunca por el solo hecho de tener el
    // evento faulty (criterio centralizado y probado, ver
    // lifecycle-repair.test.ts).
    const eligible = shouldRestoreExpiredPolicyToActive(
      { status: "EXPIRED", terminationDate: policy.terminationDate, hasAutoExpiredEvent: true },
      businessDateUtc
    );
    if (!eligible) {
      leftExpiredLegit++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.policy.update({ where: { id: policy.id }, data: { status: "ACTIVE" } });
      await tx.auditEvent.create({
        data: {
          actorUserId: null,
          actorType: "SYSTEM",
          entityType: "Policy",
          entityId: policy.id,
          action: "POLICY_STATUS_CORRECTED",
          policyId: policy.id,
          contactPersonId: policy.holderId,
          householdId: policy.householdId,
          summary:
            "Póliza restaurada a ACTIVE (Fase 025.2): había sido expirada prematuramente por una corrida de la suite de pruebas que reconcilió la tabla completa sin acotar el scope (ver POLICY_AUTO_EXPIRED anterior, conservado en el historial).",
          metadata: { reason: "premature_auto_expiration_test_isolation_bug" },
        },
      });
      await recomputeContactStatus(tx, policy.holderId);
      for (const member of policy.members) {
        await recomputeContactStatus(tx, member.personId);
      }
    });
    restored++;
  }

  console.log("---");
  console.log(`Pólizas restauradas a ACTIVE: ${restored}`);
  console.log(`Dejadas EXPIRED (terminationDate ya pasada respecto al businessDate real): ${leftExpiredLegit}`);
}

main()
  .catch((e) => {
    console.error("Error reparando incidente de lifecycle:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
