import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPolicyById } from "@/services/policies.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  POLICY_STATUS_BADGE_VARIANT,
  POLICY_STATUS_LABELS,
  POLICY_TYPE_LABELS,
  POLICY_OPERATION_TYPE_LABELS,
} from "@/lib/labels";
import { PolicyMembersSection } from "./policy-members-section";
import { HealthPolicySection } from "./health-section";
import { PolicyTasksSection } from "./tasks-section";
import { PolicyCommissionsSection } from "./commissions-section";
import { PremiumSection } from "./premium-section";
import { PolicyDocumentsSection } from "./documents-section";
import { CommissionRuleSection } from "./commission-rule-section";
import { PolicyHistorySection } from "./history-section";
import { CancelPolicyDialog } from "./cancel-policy-dialog";
import { formatDateOnlyUS } from "@/lib/date-only";

const formatDate = formatDateOnlyUS;

export default async function PolicyDetailPage({
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

  // Fase 022 (Hallazgo #3 de UAT): el titular está cubierto si aparece
  // como PolicyMember, INDEPENDIENTEMENTE de su rol — nunca se infiere
  // desde `role === "PRIMARY"` (un PolicyMember del titular con un rol
  // distinto por un bug de datos previo seguiría significando "está
  // cubierto"; el rol correcto se garantiza ahora en el servicio, ver
  // policies.service.ts).
  const holderIsCovered = policy.members.some((m) => m.person.id === policy.holder.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {policy.policyNumber ?? "Póliza sin número"}
          </h2>
          <Badge variant={POLICY_STATUS_BADGE_VARIANT[policy.status]}>
            {POLICY_STATUS_LABELS[policy.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Hallazgo #2 de UAT (Fase 024): una póliza CANCELLED nunca
              se renueva — si el cliente vuelve, se crea una póliza
              nueva desde /policies/new, nunca una "renovación" de una
              cancelada. El servicio (renewPolicy) rechaza esto también
              del lado del servidor, este botón es solo la conveniencia
              de UI que evita el viaje redondo. */}
          {policy.status !== "CANCELLED" && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/policies/${policy.id}/renew`} />}
            >
              Renovar póliza
            </Button>
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/policies/${policy.id}/edit`} />}
          >
            Editar
          </Button>
          {policy.status !== "CANCELLED" && <CancelPolicyDialog policyId={policy.id} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Resumen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Titular</span>
              <Link href={`/contacts/${policy.holder.id}`} className="underline">
                {policy.holder.firstName} {policy.holder.lastName}
              </Link>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Tipo</span>
              <span>{POLICY_TYPE_LABELS[policy.product.policyType]}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Compañía</span>
              <span>{policy.product.carrier.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Producto</span>
              <span>
                {policy.product.name}
                {policy.product.planYear ? ` (${policy.product.planYear})` : ""}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Tipo de operación</span>
              <span>{policy.operationType ? POLICY_OPERATION_TYPE_LABELS[policy.operationType] : "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Procesado por</span>
              <span>{policy.processedBy?.name ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Fechas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Fecha efectiva</span>
              <span>{formatDate(policy.effectiveDate)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Fecha de terminación</span>
              <span>{formatDate(policy.terminationDate)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <PremiumSection actor={actor} policyId={policy.id} />

      <PolicyMembersSection actor={actor} policyId={policy.id} holderIsCovered={holderIsCovered} />

      {policy.product.policyType === "HEALTH" && (
        <HealthPolicySection actor={actor} policyId={policy.id} />
      )}

      {actor.role !== "ASSISTANT" && (
        <PolicyCommissionsSection actor={actor} policyId={policy.id} />
      )}

      {actor.role === "ADMIN" && <CommissionRuleSection actor={actor} policyId={policy.id} />}

      <PolicyDocumentsSection actor={actor} policyId={policy.id} />

      <PolicyTasksSection actor={actor} policyId={policy.id} />

      <PolicyHistorySection actor={actor} policyId={policy.id} />
    </div>
  );
}
