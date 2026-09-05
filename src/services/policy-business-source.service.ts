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

// Fase 025.3 (Bloque A): variante que además devuelve la lista de
// agentes elegibles — la necesita policies.service.ts para restringir
// (server-side, nunca solo en la UI) quién puede ser processedById en
// una póliza que resultará OWN. Nunca una segunda consulta separada:
// resolvePolicyBusinessSourceAtCreation (abajo) es un envoltorio de
// esta misma función para no duplicar la lógica.
export async function getPolicyEligibility(input: {
  householdId: string | null;
  carrierId: string;
  policyType: PolicyType;
}): Promise<{ businessSource: "OWN" | "REFERRAL" | "UNKNOWN"; eligibleAgentIds: string[] }> {
  if (!input.householdId) return { businessSource: "UNKNOWN", eligibleAgentIds: [] };
  const household = await prisma.household.findUnique({
    where: { id: input.householdId },
    select: { state: true },
  });
  if (!household?.state) return { businessSource: "UNKNOWN", eligibleAgentIds: [] };

  const eligibleAgentIds = await computeEligibleAgentIds(household.state, input.carrierId, input.policyType);
  return { businessSource: determineBusinessSource(eligibleAgentIds), eligibleAgentIds };
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
  return (await getPolicyEligibility(input)).businessSource;
}

// Fase 025.3 (Bloque A): calcula, para un estado de household YA
// conocido, la lista de agentes elegibles de CADA producto de un
// catálogo — usado únicamente para que la UI (selector de "Procesado
// por" al crear/renovar/editar) pueda restringirse al mismo universo
// que el servidor exigirá, sin adivinar ni duplicar la regla de
// elegibilidad. `state` null (household desconocido o con >1 hogar,
// mismo criterio que policies.service.ts) devuelve un mapa vacío —
// ninguna restricción se puede aplicar sin un estado conocido.
export async function computeEligibleAgentIdsByProduct(
  state: string | null,
  products: { id: string; policyType: PolicyType; carrier: { id: string } }[]
): Promise<Record<string, string[]>> {
  if (!state) return {};
  const entries = await Promise.all(
    products.map(
      async (p) => [p.id, await computeEligibleAgentIds(state, p.carrier.id, p.policyType)] as const
    )
  );
  return Object.fromEntries(entries);
}
