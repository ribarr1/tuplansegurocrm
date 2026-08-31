import Link from "next/link";
import { getPremiumTrackingForPolicy } from "@/services/premiums.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BILLING_FREQUENCY_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { QuickPaymentStatusButtons } from "./quick-payment-status-buttons";

function formatMoney(amount: { toFixed: (n: number) => string } | null): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

// nextPaymentDueDate es @db.Date (fecha pura, sin hora) — se formatea
// con timeZone: "UTC" para leer el día calendario exacto tal como
// Prisma lo entrega, igual que effectiveDate/terminationDate en
// policies/[id]/page.tsx. No usar formatInBusinessTimeZone aquí: ese
// helper es para instantes (timestamps), no para columnas @db.Date.
function formatDueDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

// Prima/seguimiento de pago — módulo FINANCIERO OPERATIVO, distinto de
// Comisiones (FINANCIERO RESTRINGIDO): ASSISTANT sí ve y edita esta
// sección, a diferencia de la de Comisiones. Solo representa el
// estado actual/próximo pago — nunca un historial (ver docs/DECISIONS.md).
export async function PremiumSection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const premium = await getPremiumTrackingForPolicy(actor, policyId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Prima y pagos</CardTitle>
          {premium.isOverdue && <Badge variant="destructive">Vencida</Badge>}
          {premium.needsPaymentAssistance && <Badge variant="secondary">Requiere asistencia</Badge>}
        </div>
        <Button
          size="sm"
          variant={premium.needsPaymentAssistance ? "default" : "outline"}
          nativeButton={false}
          render={<Link href={`/policies/${policyId}/premium`} />}
        >
          {premium.needsPaymentAssistance ? "Gestionar pago" : "Editar seguimiento de pago"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Prima</span>
            <span>{formatMoney(premium.premiumAmount)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Frecuencia</span>
            <span>
              {premium.billingFrequency ? BILLING_FREQUENCY_LABELS[premium.billingFrequency] : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Próximo pago</span>
            <span>{formatDueDate(premium.nextPaymentDueDate)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Autopay</span>
            <span>{premium.autopay ? "Sí" : "No"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Estado de pago</span>
            <span>{premium.paymentStatus ? PAYMENT_STATUS_LABELS[premium.paymentStatus] : "—"}</span>
          </div>
        </div>

        <QuickPaymentStatusButtons policyId={policyId} currentStatus={premium.paymentStatus} />
      </CardContent>
    </Card>
  );
}
