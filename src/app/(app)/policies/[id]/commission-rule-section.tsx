import { getApplicableRuleForPolicy } from "@/services/commission-rules.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMMISSION_METHOD_LABELS,
  COMMISSION_BASE_LABELS,
  COMMISSION_PERIODICITY_LABELS,
} from "@/lib/labels";
import { GenerateExpectationForm } from "./generate-expectation-form";

// Regla de comisión y generación de expectativas — administrativo, ADMIN
// únicamente (mismo criterio que Comisiones/CommissionRule en general).
// Esta sección solo se renderiza para ADMIN (ver page.tsx).
export async function CommissionRuleSection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const rule = await getApplicableRuleForPolicy(actor, policyId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Regla de comisión aplicada
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {rule ? (
          <div className="flex flex-col gap-1 rounded-md border p-2">
            <span className="font-medium">
              {rule.method === "FIXED_AMOUNT" ? `$${String(rule.initialAmount)}` : `${String(rule.initialPercentage)}%`}
            </span>
            <span className="text-xs text-muted-foreground">
              {COMMISSION_BASE_LABELS[rule.base]} · {COMMISSION_METHOD_LABELS[rule.method]} ·{" "}
              {COMMISSION_PERIODICITY_LABELS[rule.initialPeriodicity]}
              {rule.policyId ? " · Override específico de esta póliza" : " · Regla del producto"}
            </span>
            {rule.residualEnabled && (
              <span className="text-xs text-muted-foreground">
                Residual desde año {rule.residualStartYear}
              </span>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            No hay una regla de comisión activa para esta póliza o su producto.
          </p>
        )}

        <GenerateExpectationForm policyId={policyId} />
      </CardContent>
    </Card>
  );
}
