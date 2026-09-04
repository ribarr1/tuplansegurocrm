import "server-only";
import { prisma } from "@/lib/prisma";
import type { PolicyType } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Propia (OWN) vs Referida (REFERRAL) — Fase 025 (Parte I).
//
// Una póliza es OWN si al menos un agente de Tu Plan Seguro tiene
// SIMULTÁNEAMENTE una AgentLicense ACTIVE en el estado de la póliza Y
// un AgentCarrierContract ACTIVE para ese mismo carrier+estado+
// policyType. En caso contrario es REFERRAL. OWN pertenece a la
// AGENCIA, no exclusivamente al agente que la tiene asignada — por
// eso esta función devuelve TODOS los agentes elegibles, no "el
// primero que califique".
//
// Fuente del "estado de la póliza": Household.state — DISTINTO de
// HealthPolicyDetail.marketplaceState (que solo existe para HEALTH y
// se captura en un paso posterior a la creación de la póliza, ver
// health-policies.service.ts). Household.state está disponible
// universalmente (cualquier tipo de póliza) y en el momento mismo de
// creación — es además la base legal correcta: la licencia de un
// agente aplica sobre el estado de RESIDENCIA del cliente, que es lo
// que Household.state representa. Ver docs/DECISIONS.md.
//
// Resultado STORED, nunca recalculado silenciosamente después de la
// creación (ver Policy.businessSource, policies.service.ts) — si un
// contrato termina después, las pólizas ya clasificadas como OWN
// conservan esa clasificación histórica.
// ---------------------------------------------------------------------------

export async function computeEligibleAgentIds(
  state: string,
  carrierId: string,
  policyType: PolicyType
): Promise<string[]> {
  const [licenses, contracts] = await Promise.all([
    prisma.agentLicense.findMany({
      where: { state, status: "ACTIVE" },
      select: { userId: true },
    }),
    prisma.agentCarrierContract.findMany({
      where: { state, carrierId, policyType, status: "ACTIVE" },
      select: { userId: true },
    }),
  ]);
  const licensedUserIds = new Set(licenses.map((l) => l.userId));
  const eligible = new Set(contracts.filter((c) => licensedUserIds.has(c.userId)).map((c) => c.userId));
  return Array.from(eligible);
}

export function determineBusinessSource(eligibleAgentIds: string[]): "OWN" | "REFERRAL" {
  return eligibleAgentIds.length > 0 ? "OWN" : "REFERRAL";
}

// Resuelve businessSource para una póliza en el momento de creación,
// a partir del estado del household (si se conoce) — nunca adivina un
// estado. Devuelve UNKNOWN cuando el household no tiene state
// (todavía) — un valor honesto de "no se puede clasificar todavía",
// nunca REFERRAL por defecto (que sería una afirmación falsa sobre el
// negocio).
export async function resolvePolicyBusinessSourceAtCreation(input: {
  householdId: string | null;
  carrierId: string;
  policyType: PolicyType;
}): Promise<"OWN" | "REFERRAL" | "UNKNOWN"> {
  if (!input.householdId) return "UNKNOWN";
  const household = await prisma.household.findUnique({
    where: { id: input.householdId },
    select: { state: true },
  });
  if (!household?.state) return "UNKNOWN";

  const eligible = await computeEligibleAgentIds(household.state, input.carrierId, input.policyType);
  return determineBusinessSource(eligible);
}
