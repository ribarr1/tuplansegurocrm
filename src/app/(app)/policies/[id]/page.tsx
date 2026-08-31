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
  POLICY_MEMBER_ROLE_LABELS,
  BILLING_FREQUENCY_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import { HealthPolicySection } from "./health-section";
import { PolicyTasksSection } from "./tasks-section";
import { PolicyCommissionsSection } from "./commissions-section";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

function formatMoney(amount: unknown): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

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

  const holderIsCovered = policy.members.some((m) => m.role === "PRIMARY");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {policy.policyNumber ?? "Póliza sin número"}
          </h2>
          <Badge variant={POLICY_STATUS_BADGE_VARIANT[policy.status]}>
            {POLICY_STATUS_LABELS[policy.status]}
          </Badge>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/policies/${policy.id}/edit`} />}
        >
          Editar
        </Button>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Fechas y pago</CardTitle>
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
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Prima</span>
              <span>{formatMoney(policy.premiumAmount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Frecuencia de pago</span>
              <span>{policy.billingFrequency ? BILLING_FREQUENCY_LABELS[policy.billingFrequency] : "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Próximo pago</span>
              <span>{formatDate(policy.nextPaymentDueDate)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Estado de pago</span>
              <span>{policy.paymentStatus ? PAYMENT_STATUS_LABELS[policy.paymentStatus] : "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Autopay</span>
              <span>{policy.autopay ? "Sí" : "No"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Necesita asistencia de pago</span>
              <span>{policy.needsPaymentAssistance ? "Sí" : "No"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Personas cubiertas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {!holderIsCovered && (
            <p className="text-xs text-muted-foreground">
              El titular no está cubierto por esta póliza.
            </p>
          )}
          {policy.members.length === 0 ? (
            <p className="text-muted-foreground">Nadie está cubierto todavía.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {policy.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-4">
                  <Link href={`/contacts/${member.person.id}`} className="underline">
                    {member.person.firstName} {member.person.lastName}
                  </Link>
                  <Badge variant="outline">{POLICY_MEMBER_ROLE_LABELS[member.role]}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {policy.product.policyType === "HEALTH" && (
        <HealthPolicySection actor={actor} policyId={policy.id} />
      )}

      {actor.role !== "ASSISTANT" && (
        <PolicyCommissionsSection actor={actor} policyId={policy.id} />
      )}

      <PolicyTasksSection actor={actor} policyId={policy.id} />
    </div>
  );
}
