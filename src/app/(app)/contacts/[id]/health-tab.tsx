import Link from "next/link";
import { getPoliciesForPerson } from "@/services/policies.service";
import { getHealthPolicyDetail } from "@/services/health-policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  POLICY_STATUS_BADGE_VARIANT,
  POLICY_STATUS_LABELS,
} from "@/lib/labels";

const HEALTH_SOURCE_LABELS: Record<string, string> = {
  MARKETPLACE: "Marketplace",
  PRIVATE: "Privado",
};

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function formatMoney(amount: { toFixed: (n: number) => string } | null | undefined): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

// Vista AGREGADA de las pólizas HEALTH del contacto — nunca duplica
// HealthPolicyDetail, lo consulta explícitamente por cada póliza (Fase
// 013/019.5). incomeUsed/taxCreditAmount llegan ya redactados por el
// servicio para ASSISTANT (la clave ni siquiera existe en el objeto) —
// esta vista no necesita ninguna lógica adicional de ocultamiento.
export async function HealthTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const policies = await getPoliciesForPerson(actor, personId);
  const healthPolicies = policies.filter((p) => p.product.policyType === "HEALTH");

  if (healthPolicies.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">Este contacto no tiene pólizas de Salud.</p>
      </div>
    );
  }

  const details = await Promise.all(
    healthPolicies.map((p) => getHealthPolicyDetail(actor, p.id))
  );

  return (
    <div className="flex flex-col gap-4">
      {healthPolicies.map((policy, i) => {
        const detail = details[i];
        return (
          <Card key={policy.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium">
                  {policy.product.carrier.name} — {policy.product.name}
                </CardTitle>
                <Badge variant={POLICY_STATUS_BADGE_VARIANT[policy.status]}>
                  {POLICY_STATUS_LABELS[policy.status]}
                </Badge>
                {policy.healthCoverageSource && (
                  <Badge variant="outline">{HEALTH_SOURCE_LABELS[policy.healthCoverageSource]}</Badge>
                )}
              </div>
              <Link href={`/policies/${policy.id}`} className="text-sm underline">
                Ver póliza
              </Link>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Fecha efectiva</span>
                <span>{formatDate(policy.effectiveDate)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Prima</span>
                <span>{formatMoney(policy.premiumAmount)}</span>
              </div>
              {detail ? (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Plan (snapshot)</span>
                    <span>{detail.planNameSnapshot ?? "—"}</span>
                  </div>
                  {policy.healthCoverageSource === "MARKETPLACE" && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Marketplace Application ID</span>
                      <span>{detail.marketplaceApplicationId ?? "—"}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Deducible individual</span>
                    <span>{formatMoney(detail.deductibleIndividual)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">OOP individual</span>
                    <span>{formatMoney(detail.outOfPocketIndividual)}</span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground sm:col-span-2">
                  Sin información de plan de salud registrada.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
