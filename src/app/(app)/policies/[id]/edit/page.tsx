import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPolicyById, listActiveProducts } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { EditPolicyForm } from "../edit-policy-form";
import { updatePolicyAction } from "../../actions";

export default async function EditPolicyPage({
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

  // Hallazgo #4 de UAT (Parte D): CANCELLED/EXPIRED son de solo lectura
  // — el botón "Editar" ya está oculto en la vista de detalle y el
  // servicio (updatePolicy) también lo rechaza, pero si alguien navega
  // directo a esta URL debe ver un mensaje claro, no un error crudo.
  if (policy.status === "CANCELLED" || policy.status === "EXPIRED") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">
          Esta póliza está {policy.status === "CANCELLED" ? "cancelada" : "expirada"} y es de solo
          lectura — sus datos se conservan como historial pero no pueden modificarse.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href={`/policies/${id}`} />}>
          Volver a la póliza
        </Button>
      </div>
    );
  }

  // Regla de edición (docs/DECISIONS.md): el producto solo puede
  // cambiar mientras la póliza está PENDING.
  const canChangeProduct = policy.status === "PENDING";
  const products = canChangeProduct
    ? await listActiveProducts(actor, { policyType: policy.product.policyType })
    : [];

  const showProcessedBySelect = actor.role === "ADMIN";
  const activeAgents = showProcessedBySelect ? await listActiveAgents(actor) : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">
        Editar póliza — {policy.policyNumber ?? "sin número"}
      </h2>
      <EditPolicyForm
        action={updatePolicyAction.bind(null, id)}
        defaultValues={{
          productId: policy.product.id,
          policyNumber: policy.policyNumber ?? undefined,
          status: policy.status,
          effectiveDate: policy.effectiveDate ? policy.effectiveDate.toISOString().slice(0, 10) : undefined,
          terminationDate: policy.terminationDate
            ? policy.terminationDate.toISOString().slice(0, 10)
            : undefined,
          premiumAmount: policy.premiumAmount ? policy.premiumAmount.toString() : undefined,
          billingFrequency: policy.billingFrequency ?? undefined,
          nextPaymentDueDate: policy.nextPaymentDueDate
            ? policy.nextPaymentDueDate.toISOString().slice(0, 10)
            : undefined,
          paymentManagementMode: policy.paymentManagementMode,
          paymentStatus: policy.paymentStatus ?? undefined,
          operationType: policy.operationType ?? undefined,
          healthCoverageSource: policy.healthCoverageSource ?? undefined,
        }}
        canChangeProduct={canChangeProduct}
        products={products}
        showProcessedBySelect={showProcessedBySelect}
        activeAgents={activeAgents}
        isHealthPolicy={policy.product.policyType === "HEALTH"}
      />
    </div>
  );
}
