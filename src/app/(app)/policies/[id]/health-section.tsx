import Link from "next/link";
import { getHealthPolicyDetail } from "@/services/health-policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatMoney(amount: unknown): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

// Solo se renderiza cuando Policy.product.policyType === HEALTH (ver
// policies/[id]/page.tsx). getHealthPolicyDetail ya redacta
// incomeUsed/taxCreditAmount para ASSISTANT — esta sección nunca decide
// qué mostrar por rol, solo renderiza lo que el servicio ya autorizó.
export async function HealthPolicySection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const detail = await getHealthPolicyDetail(actor, policyId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Información del plan de salud
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/policies/${policyId}/health`} />}
        >
          {detail ? "Editar" : "Agregar información de salud"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!detail ? (
          <p className="text-muted-foreground">Información de salud no registrada.</p>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Application ID (Marketplace)</span>
              <span>{detail.marketplaceApplicationId ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Estado</span>
              <span>{detail.marketplaceState ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Nombre del plan</span>
              <span>{detail.planNameSnapshot ?? "—"}</span>
            </div>
            {"taxCreditAmount" in detail && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Crédito fiscal</span>
                <span>{formatMoney(detail.taxCreditAmount)}</span>
              </div>
            )}
            {"incomeUsed" in detail && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Ingreso utilizado</span>
                <span>{formatMoney(detail.incomeUsed)}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Deducible individual</span>
              <span>{formatMoney(detail.deductibleIndividual)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Deducible familiar</span>
              <span>{formatMoney(detail.deductibleFamily)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Out-of-pocket individual</span>
              <span>{formatMoney(detail.outOfPocketIndividual)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Out-of-pocket familiar</span>
              <span>{formatMoney(detail.outOfPocketFamily)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
