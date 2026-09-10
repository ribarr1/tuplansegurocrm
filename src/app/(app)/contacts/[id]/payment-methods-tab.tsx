import type { AuthorizedUser } from "@/lib/authorization";
import { listPaymentMethods } from "@/services/payment-methods.service";
import { getPoliciesForPerson } from "@/services/policies.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreatePaymentMethodForm } from "./create-payment-method-form";
import { PaymentMethodRow } from "./payment-method-row";

// "Pagos" — vault de métodos de pago cifrados (AMPLIACIÓN PREPRODUCCIÓN
// — Analítica y datos de pago). A diferencia de "Accesos" (Fase 025,
// Parte J), aquí la autorización es de UN SOLO NIVEL: exclusivamente
// role=ADMIN, sin excepción — esta pestaña ni siquiera debe renderizarse
// para AGENT/ASSISTANT (ver page.tsx), pero el Server Component también
// depende de listPaymentMethods para rechazar server-side si alguien
// manipulara la navegación.
export async function PaymentMethodsTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const [items, rawPolicies] = await Promise.all([
    listPaymentMethods(actor, personId),
    getPoliciesForPerson(actor, personId),
  ]);

  const policies = rawPolicies.map((p) => ({
    id: p.id,
    label: `${p.product.carrier.name} — ${p.product.name}${p.policyNumber ? ` (${p.policyNumber})` : ""}`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Métodos de pago</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          El CRM no ejecuta cobros. Estos datos se usan únicamente para ayudar a configurar el pago en el portal de
          la compañía. El CVV nunca se almacena — debe solicitarse al cliente cuando la compañía lo requiera.
        </p>

        <CreatePaymentMethodForm personId={personId} policies={policies} />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin métodos de pago registrados.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <PaymentMethodRow
                key={item.id}
                personId={personId}
                paymentMethodId={item.id}
                maskedLabel={item.maskedLabel}
                isDefault={item.isDefault}
                autopay={item.autopay}
                isActive={item.isActive}
                comment={item.comment ?? ""}
                policyId={item.policyId}
                policies={policies}
                secretFields={
                  item.type === "BANK_ACCOUNT"
                    ? [
                        { field: "routingNumber", label: "routing number" },
                        { field: "accountNumber", label: "número de cuenta" },
                      ]
                    : [{ field: "cardNumber", label: "número de tarjeta" }]
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
