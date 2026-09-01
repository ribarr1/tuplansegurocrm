import { prisma } from "@/lib/prisma";
import type { ImportPlan, HouseholdPlanEntry, PolicyPlanEntry } from "./types";

// Escritura en PostgreSQL — Fase 019. Se ejecuta DENTRO de una sola
// transacción global (ver docs/DECISIONS.md #33): el volumen real de
// este import es pequeño (decenas de filas), así que una transacción
// completa es preferible a bundles por household/policy — si algo
// falla a mitad de camino, rollback completo, nunca una importación
// parcial silenciosa.
//
// Idempotencia (ver docs/DECISIONS.md #34): sin legacyImportId en el
// schema, cada entidad se resuelve contra el estado ACTUAL de la base
// de datos dentro de la misma transacción antes de decidir crear o
// reutilizar — nunca se confía únicamente en un P2002. Person ya
// resuelve esto en matching.ts (vuelve a matchear contra la DB en cada
// llamada); Household/Policy/HealthPolicyDetail/CommissionExpectation/
// CommissionPayment tienen su propia verificación explícita aquí.

export type ApplyResult = {
  personsCreated: number;
  personsReused: number;
  householdsCreated: number;
  householdsReused: number;
  policiesCreated: number;
  policiesSkippedExisting: number;
  healthDetailsCreated: number;
  healthDetailsSkippedExisting: number;
  commissionExpectationsCreated: number;
  commissionExpectationsSkippedExisting: number;
  commissionPaymentsCreated: number;
  commissionPaymentsSkippedExisting: number;
};

export async function applyImportPlan(plan: ImportPlan): Promise<ApplyResult> {
  if (!plan.readyToImport) {
    throw new Error("El plan tiene errores BLOCKING — no se puede aplicar (READY_TO_IMPORT=false).");
  }

  return prisma.$transaction(async (tx) => {
    const result: ApplyResult = {
      personsCreated: 0,
      personsReused: 0,
      householdsCreated: 0,
      householdsReused: 0,
      policiesCreated: 0,
      policiesSkippedExisting: 0,
      healthDetailsCreated: 0,
      healthDetailsSkippedExisting: 0,
      commissionExpectationsCreated: 0,
      commissionExpectationsSkippedExisting: 0,
      commissionPaymentsCreated: 0,
      commissionPaymentsSkippedExisting: 0,
    };

    // --- Persons ---
    const keyToPersonId = new Map<string, string>();
    for (const p of plan.persons) {
      if (p.outcome === "AMBIGUOUS" || p.outcome === "CONFLICT") continue; // nunca se importan
      if (p.outcome === "MATCHED" && p.existingPersonId) {
        keyToPersonId.set(p.key, p.existingPersonId);
        result.personsReused++;
        continue;
      }
      if (keyToPersonId.has(p.key)) continue; // ya creado por una fila anterior con la misma key
      const created = await tx.person.create({
        data: {
          firstName: p.data.firstName,
          lastName: p.data.lastName,
          email: p.data.email,
          phone: p.data.phone,
          dateOfBirth: p.data.dateOfBirth,
          contactStatus: "CLIENT",
        },
        select: { id: true },
      });
      keyToPersonId.set(p.key, created.id);
      result.personsCreated++;
    }

    // --- Households ---
    const householdRowToId = new Map<HouseholdPlanEntry, string>();
    for (const h of plan.households) {
      const headPersonId = keyToPersonId.get(h.headPersonKey);
      if (!headPersonId) continue; // titular quedó AMBIGUOUS/CONFLICT, no se puede crear el household

      const existingMembership = await tx.householdMember.findFirst({
        where: { personId: headPersonId, role: "HEAD" },
        select: { householdId: true },
      });
      let householdId: string;
      if (existingMembership) {
        householdId = existingMembership.householdId;
        result.householdsReused++;
      } else {
        // addressLine1/county solo se escriben al CREAR el household —
        // nunca sobrescriben uno ya existente reutilizado (misma regla
        // de "no reescribir historial" que el resto del importador).
        const created = await tx.household.create({
          data: { addressLine1: h.addressLine1 ?? null, county: h.county ?? null },
          select: { id: true },
        });
        householdId = created.id;
        result.householdsCreated++;
      }
      householdRowToId.set(h, householdId);

      for (const member of h.memberKeys) {
        const memberPersonId = keyToPersonId.get(member.personKey);
        if (!memberPersonId) continue;
        const exists = await tx.householdMember.findUnique({
          where: { personId_householdId: { personId: memberPersonId, householdId } },
          select: { id: true },
        });
        if (!exists) {
          await tx.householdMember.create({
            data: { personId: memberPersonId, householdId, role: member.role },
          });
        }
      }
    }

    // --- Carriers / Products (creados solo si el mapping ya los declaró explícitamente) ---
    const carrierIdCache = new Map<string, string>();
    async function resolveCarrierId(name: string): Promise<string> {
      const cached = carrierIdCache.get(name);
      if (cached) return cached;
      const existing = await tx.carrier.findUnique({ where: { name }, select: { id: true } });
      const id = existing ? existing.id : (await tx.carrier.create({ data: { name }, select: { id: true } })).id;
      carrierIdCache.set(name, id);
      return id;
    }

    const productIdCache = new Map<string, string>();
    async function resolveProductId(carrierId: string, planName: string): Promise<string> {
      const cacheKey = `${carrierId}::${planName.trim().toUpperCase()}`;
      const cached = productIdCache.get(cacheKey);
      if (cached) return cached;
      const existing = await tx.product.findFirst({
        where: { carrierId, name: { equals: planName, mode: "insensitive" } },
        select: { id: true },
      });
      const id = existing
        ? existing.id
        : (
            await tx.product.create({
              data: { carrierId, name: planName, policyType: "HEALTH" },
              select: { id: true },
            })
          ).id;
      productIdCache.set(cacheKey, id);
      return id;
    }

    // --- Policies (+ HealthPolicyDetail + premium tracking) ---
    const policyRowToId = new Map<PolicyPlanEntry, string>();
    for (const pol of plan.policies) {
      if (pol.blocked) continue;
      const holderId = keyToPersonId.get(pol.holderPersonKey);
      if (!holderId) continue;

      const carrierId = await resolveCarrierId(pol.carrierName);
      const productId = await resolveProductId(carrierId, pol.planName);

      const existingPolicy = await tx.policy.findFirst({
        where: { holderId, productId, effectiveDate: pol.effectiveDate },
        select: { id: true },
      });
      let policyId: string;
      if (existingPolicy) {
        policyId = existingPolicy.id;
        result.policiesSkippedExisting++;
      } else {
        const householdEntry = plan.households.find((h) => h.headPersonKey === pol.holderPersonKey);
        const householdId = householdEntry ? householdRowToId.get(householdEntry) : undefined;
        const created = await tx.policy.create({
          data: {
            holderId,
            productId,
            householdId: householdId ?? null,
            status: pol.status,
            effectiveDate: pol.effectiveDate,
            terminationDate: pol.terminationDate,
            healthCoverageSource: pol.healthCoverageSource,
            operationType: pol.operationType,
            premiumAmount: pol.premiumAmount,
            needsPaymentAssistance: pol.needsPaymentAssistance,
          },
          select: { id: true },
        });
        policyId = created.id;
        result.policiesCreated++;

        if (pol.holderCovered) {
          await tx.policyMember.create({ data: { policyId, personId: holderId, role: "PRIMARY" } });
        }
        for (const member of pol.coveredMemberKeys) {
          const memberPersonId = keyToPersonId.get(member.personKey);
          if (!memberPersonId) continue;
          await tx.policyMember.create({ data: { policyId, personId: memberPersonId, role: member.role } });
        }
      }
      policyRowToId.set(pol, policyId);

      const hasHealthData =
        pol.marketplaceState || pol.deductibleIndividual || pol.outOfPocketIndividual || pol.incomeUsed || pol.taxCreditAmount;
      if (hasHealthData) {
        const existingDetail = await tx.healthPolicyDetail.findUnique({ where: { policyId }, select: { id: true } });
        if (existingDetail) {
          result.healthDetailsSkippedExisting++;
        } else {
          await tx.healthPolicyDetail.create({
            data: {
              policyId,
              marketplaceState: pol.marketplaceState,
              planNameSnapshot: pol.planName,
              deductibleIndividual: pol.deductibleIndividual,
              outOfPocketIndividual: pol.outOfPocketIndividual,
              incomeUsed: pol.incomeUsed,
              taxCreditAmount: pol.taxCreditAmount,
            },
          });
          result.healthDetailsCreated++;
        }
      }
    }

    // --- Commission expectations ---
    for (const exp of plan.commissionExpectations) {
      const policyId = policyRowToId.get(exp.matchedPolicy);
      if (!policyId) continue; // la póliza vinculada quedó bloqueada/sin crear

      const existing = await tx.commissionExpectation.findUnique({
        where: { policyId_period: { policyId, period: exp.period } },
        select: { id: true },
      });
      if (existing) {
        result.commissionExpectationsSkippedExisting++;
        continue;
      }
      await tx.commissionExpectation.create({
        data: { policyId, period: exp.period, expectedAmount: exp.expectedAmount },
      });
      result.commissionExpectationsCreated++;
    }

    // --- Commission payments ---
    for (const pay of plan.commissionPayments) {
      const policyId = policyRowToId.get(pay.matchedPolicy);
      if (!policyId) continue; // la póliza vinculada quedó bloqueada/sin crear

      const expectation = await tx.commissionExpectation.findUnique({
        where: { policyId_period: { policyId, period: pay.period } },
        select: { id: true },
      });
      if (!expectation) continue; // sin expectativa para ese período, no se puede vincular el pago

      // Clave de idempotencia a nivel de aplicación (sin schema nuevo):
      // mismo expectationId + mismo día exacto de receivedAt + type
      // PAYMENT + mismo monto => ya se importó, se omite.
      const existingPayment = await tx.commissionPayment.findFirst({
        where: {
          commissionExpectationId: expectation.id,
          type: "PAYMENT",
          receivedAt: pay.period,
          amount: pay.amount,
        },
        select: { id: true },
      });
      if (existingPayment) {
        result.commissionPaymentsSkippedExisting++;
        continue;
      }
      await tx.commissionPayment.create({
        data: {
          commissionExpectationId: expectation.id,
          amount: pay.amount,
          type: "PAYMENT",
          receivedAt: pay.period,
          notes: "Importado de hoja legacy 'Comisiones' como monto mensual consolidado (no representa movimientos individuales).",
        },
      });
      result.commissionPaymentsCreated++;
    }

    return result;
  });
}

