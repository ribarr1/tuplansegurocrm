import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPolicyById } from "@/services/policies.service";
import { getHealthPolicyDetail } from "@/services/health-policies.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { HealthDetailForm } from "./health-detail-form";
import { createHealthDetailAction, updateHealthDetailAction } from "./actions";

export default async function HealthPolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let policy;
  try {
    policy = await getPolicyById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a esta póliza.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/policies" />}>
            Volver
          </Button>
        </div>
      );
    }
    throw error;
  }

  if (policy.product.policyType !== "HEALTH") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">Esta póliza no es de tipo Salud.</p>
        <Button variant="outline" nativeButton={false} render={<Link href={`/policies/${id}`} />}>
          Volver a la póliza
        </Button>
      </div>
    );
  }

  const existing = await getHealthPolicyDetail(actor, id);
  const showFinancialFields = actor.role !== "ASSISTANT";

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">
        {existing ? "Editar" : "Agregar"} información de salud — {policy.policyNumber ?? "sin número"}
      </h2>
      {existing ? (
        <HealthDetailForm
          action={updateHealthDetailAction.bind(null, id)}
          defaultValues={{
            marketplaceApplicationId: existing.marketplaceApplicationId ?? undefined,
            marketplaceState: existing.marketplaceState ?? undefined,
            planNameSnapshot: existing.planNameSnapshot ?? undefined,
            taxCreditAmount:
              "taxCreditAmount" in existing ? (existing.taxCreditAmount?.toString() ?? undefined) : undefined,
            incomeUsed:
              "incomeUsed" in existing ? (existing.incomeUsed?.toString() ?? undefined) : undefined,
            deductibleIndividual: existing.deductibleIndividual?.toString() ?? undefined,
            deductibleFamily: existing.deductibleFamily?.toString() ?? undefined,
            outOfPocketIndividual: existing.outOfPocketIndividual?.toString() ?? undefined,
            outOfPocketFamily: existing.outOfPocketFamily?.toString() ?? undefined,
          }}
          showFinancialFields={showFinancialFields}
          submitLabel="Guardar cambios"
        />
      ) : (
        <HealthDetailForm
          action={createHealthDetailAction.bind(null, id)}
          // planNameSnapshot se prellena con Product.name al crear (no
          // al editar) — punto de partida razonable, pero queda
          // completamente editable y nunca se vuelve a sincronizar
          // automáticamente después de guardado (ver docs/DECISIONS.md).
          defaultValues={{ planNameSnapshot: policy.product.name }}
          showFinancialFields={showFinancialFields}
          submitLabel="Guardar información de salud"
        />
      )}
    </div>
  );
}
