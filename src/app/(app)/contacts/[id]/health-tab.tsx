import Link from "next/link";
import { getPoliciesForPerson } from "@/services/policies.service";
import { getHealthPolicyDetail } from "@/services/health-policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  POLICY_STATUS_BADGE_VARIANT,
  POLICY_STATUS_LABELS,
  HEALTH_COVERAGE_SOURCE_LABELS,
} from "@/lib/labels";
import { formatDateOnlyUS } from "@/lib/date-only";
import { MedicationsSection } from "./medications-section";
import { ProvidersSection } from "./providers-section";

const formatDate = formatDateOnlyUS;

function formatMoney(amount: { toFixed: (n: number) => string } | null | undefined): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

// Vista AGREGADA de las pólizas HEALTH del contacto — nunca duplica
// HealthPolicyDetail, lo consulta explícitamente por cada póliza (Fase
// 013/019.5). incomeUsed/taxCreditAmount llegan ya redactados por el
// servicio para ASSISTANT (la clave ni siquiera existe en el objeto) —
// esta vista no necesita ninguna lógica adicional de ocultamiento.
// Fase 019.8 (hallazgo #18 de UAT): Medicamentos y Médicos/proveedores
// se muestran SIEMPRE, incluso sin pólizas de Salud — viven en Person,
// no en Policy (una persona puede no tener ninguna póliza de Salud
// todavía y aun así necesitar registrar su medicación actual).
export async function HealthTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const policies = await getPoliciesForPerson(actor, personId);
  const healthPolicies = policies.filter((p) => p.product.policyType === "HEALTH");
  const details =
    healthPolicies.length > 0
      ? await Promise.all(healthPolicies.map((p) => getHealthPolicyDetail(actor, p.id)))
      : [];

  return (
    <div className="flex flex-col gap-4">
      {healthPolicies.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">Este contacto no tiene pólizas de Salud.</p>
        </div>
      ) : (
      healthPolicies.map((policy, i) => {
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
                  <Badge variant="outline">{HEALTH_COVERAGE_SOURCE_LABELS[policy.healthCoverageSource]}</Badge>
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
      })
      )}

      <MedicationsSection actor={actor} personId={personId} />
      <ProvidersSection actor={actor} personId={personId} />
    </div>
  );
}
