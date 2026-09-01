import { listCommissionRulesForProduct } from "@/services/commission-rules.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMMISSION_METHOD_LABELS,
  COMMISSION_BASE_LABELS,
  COMMISSION_PERIODICITY_LABELS,
} from "@/lib/labels";
import { CommissionRuleForm } from "./commission-rule-form";
import { DeactivateRuleButton } from "./deactivate-rule-button";

function formatRuleAmount(rule: {
  method: string;
  initialAmount: unknown;
  initialPercentage: unknown;
}): string {
  if (rule.method === "FIXED_AMOUNT") return `$${String(rule.initialAmount)}`;
  return `${String(rule.initialPercentage)}%`;
}

// Configuración administrativa (cómo se le paga al negocio) — solo
// ADMIN administra reglas, mismo criterio que Comisiones (Fase 016).
// Esta sección solo se renderiza para ADMIN (ver edit/page.tsx).
export async function CommissionRulesSection({
  actor,
  productId,
}: {
  actor: AuthorizedUser;
  productId: string;
}) {
  const rules = await listCommissionRulesForProduct(actor, productId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Regla de comisión del producto
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {rules.length === 0 ? (
          <p className="text-muted-foreground">Este producto no tiene reglas de comisión configuradas.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatRuleAmount(rule)}</span>
                    <span className="text-xs text-muted-foreground">
                      {COMMISSION_BASE_LABELS[rule.base as keyof typeof COMMISSION_BASE_LABELS]} ·{" "}
                      {COMMISSION_METHOD_LABELS[rule.method as keyof typeof COMMISSION_METHOD_LABELS]} ·{" "}
                      {
                        COMMISSION_PERIODICITY_LABELS[
                          rule.initialPeriodicity as keyof typeof COMMISSION_PERIODICITY_LABELS
                        ]
                      }
                    </span>
                  </div>
                  {rule.residualEnabled && (
                    <span className="text-xs text-muted-foreground">
                      Residual: {rule.method === "FIXED_AMOUNT" ? `$${String(rule.residualAmount)}` : `${String(rule.residualPercentage)}%`}{" "}
                      (
                      {rule.residualPeriodicity
                        ? COMMISSION_PERIODICITY_LABELS[
                            rule.residualPeriodicity as keyof typeof COMMISSION_PERIODICITY_LABELS
                          ]
                        : "—"}
                      , desde año {rule.residualStartYear})
                    </span>
                  )}
                  {rule.policyId && (
                    <span className="text-xs text-muted-foreground">Override específico de una póliza</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={rule.isActive ? "default" : "outline"}>
                    {rule.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                  {rule.isActive && <DeactivateRuleButton productId={productId} ruleId={rule.id} />}
                </div>
              </div>
            ))}
          </div>
        )}

        <CommissionRuleForm productId={productId} />
      </CardContent>
    </Card>
  );
}
