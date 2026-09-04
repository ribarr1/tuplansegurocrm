import { notFound, redirect, forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPolicyById } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { ExpectationForm } from "../expectation-form";
import { createCommissionExpectationAction } from "../actions";

// Solo ADMIN crea expectativas — el punto de entrada real es
// /policies/[id] -> "Agregar comisión esperada" (ver commissions-section.tsx),
// por eso policyId siempre llega por query param, nunca se elige aquí
// de una lista abierta de pólizas.
export default async function NewCommissionExpectationPage({
  searchParams,
}: {
  searchParams: Promise<{ policyId?: string }>;
}) {
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();
  if (actor.role !== "ADMIN") redirect("/commissions");

  const { policyId } = await searchParams;
  if (!policyId) redirect("/commissions");

  let policy;
  try {
    policy = await getPolicyById(actor, policyId);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  const activeAgents = await listActiveAgents(actor);
  // processedBy puede no ser un AGENT (puede ser otro ADMIN) — solo se
  // preselecciona si de verdad está en la lista de agentes elegibles
  // (ver docs/DECISIONS.md: processedBy y "agente comisionable" no son
  // equivalentes, esto es solo una sugerencia de UI).
  const defaultAgentId = activeAgents.some((a) => a.id === policy.processedBy?.id)
    ? policy.processedBy?.id
    : undefined;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nueva comisión esperada</h2>
      <ExpectationForm
        action={createCommissionExpectationAction}
        policyId={policy.id}
        policyLabel={`${policy.policyNumber ?? "Sin número"} — ${policy.holder.firstName} ${policy.holder.lastName}`}
        activeAgents={activeAgents}
        defaultAgentId={defaultAgentId}
      />
    </div>
  );
}
