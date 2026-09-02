import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPolicyById, listActiveProducts } from "@/services/policies.service";
import { AppError } from "@/services/errors";
import { listActiveAgents } from "@/services/users.service";
import { PolicyForm, type CoveredCandidate } from "../../policy-form";
import { renewPolicyAction } from "../../actions";

// Hallazgo #3 de UAT (Fase 019.9): "Renovar póliza" crea una Policy
// NUEVA (nunca modifica destructivamente la anterior). Prefila
// producto/billing/autopay/asistencia/agente/miembros desde la póliza
// vieja como DEFAULTS editables — el usuario siempre confirma/edita
// antes de guardar. policyNumber/effectiveDate/terminationDate NUNCA
// se prefijan (ver policy-form.tsx). previousPolicyId se fija en el
// servicio, no en este formulario.
export default async function RenewPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();

  let oldPolicy;
  try {
    oldPolicy = await getPolicyById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  const products = await listActiveProducts(actor, { policyType: oldPolicy.product.policyType });

  const candidates: CoveredCandidate[] = oldPolicy.members
    .filter((m) => m.role !== "PRIMARY")
    .map((m) => ({
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      // La filiación familiar real no viaja en policySelect — se
      // muestra "Otro" aquí solo como sugerencia de rol de cobertura,
      // el usuario puede ajustarlo (mismo principio que Fase 019.7).
      householdRole: "OTHER",
    }));

  const holderWasCovered = oldPolicy.members.some((m) => m.role === "PRIMARY");
  const showProcessedBySelect = actor.role === "ADMIN";
  const activeAgents = showProcessedBySelect ? await listActiveAgents(actor) : [];

  const action = renewPolicyAction.bind(null, oldPolicy.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Renovar póliza</h2>
      <p className="text-sm text-muted-foreground">
        Se creará una póliza nueva vinculada a esta como su renovación — la póliza actual nunca se
        modifica. Revisa y confirma los datos antes de guardar; número de póliza y fechas siempre se
        capturan de nuevo.
      </p>

      <PolicyForm
        action={action}
        holderId={oldPolicy.holder.id}
        holderLabel={`${oldPolicy.holder.firstName} ${oldPolicy.holder.lastName}`}
        products={products}
        candidates={candidates}
        showProcessedBySelect={showProcessedBySelect}
        activeAgents={activeAgents}
        defaultValues={{
          productId: oldPolicy.product.id,
          healthCoverageSource: oldPolicy.healthCoverageSource ?? "",
          holderCovered: holderWasCovered ? "true" : "false",
          billingFrequency: oldPolicy.billingFrequency ?? "",
          autopay: oldPolicy.autopay ? "true" : "false",
          needsPaymentAssistance: oldPolicy.needsPaymentAssistance ? "true" : "false",
          processedById: oldPolicy.processedBy?.id ?? "",
          operationType: "RENEWAL",
        }}
        defaultCoveredMemberIds={candidates.map((c) => c.id)}
        submitLabel="Crear póliza renovada"
      />
    </div>
  );
}
