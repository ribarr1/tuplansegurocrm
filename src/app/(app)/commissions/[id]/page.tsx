import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getCommissionExpectationById } from "@/services/commissions.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COMMISSION_PAYMENT_TYPE_LABELS,
  COMMISSION_DERIVED_STATUS_LABELS,
  COMMISSION_DERIVED_STATUS_BADGE_VARIANT,
} from "@/lib/labels";
import { formatInBusinessTimeZone } from "@/lib/business-time";
import { EditExpectationForm } from "./edit-expectation-form";
import { PaymentForm } from "./payment-form";
import { CancelExpectationButton } from "./cancel-button";
import { updateCommissionExpectationAction, addCommissionPaymentAction } from "../actions";

function formatMoney(amount: { toFixed: (n: number) => string }): string {
  return `$${amount.toFixed(2)}`;
}

function formatPeriod(date: Date): string {
  return new Intl.DateTimeFormat("es-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date
  );
}

function periodToMonthInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatReceivedAt(date: Date): string {
  return formatInBusinessTimeZone(date, { dateStyle: "medium", timeStyle: "short" });
}

// Comisiones es FINANCIERO/RESTRINGIDO — ASSISTANT recibe un 403 real
// (ver /commissions/page.tsx). AGENT ve esta página en modo solo
// lectura: getCommissionExpectationById ya valida que tenga acceso a
// la póliza subyacente (canAccessPolicy), y aquí además se ocultan los
// formularios de edición/pago/cancelación.
export default async function CommissionExpectationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();

  let expectation;
  try {
    expectation = await getCommissionExpectationById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a esta comisión.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/commissions" />}>
            Volver
          </Button>
        </div>
      );
    }
    throw error;
  }

  const isAdmin = actor.role === "ADMIN";
  const activeAgents = isAdmin ? await listActiveAgents(actor) : [];

  const updateAction = updateCommissionExpectationAction.bind(null, expectation.id);
  const paymentAction = addCommissionPaymentAction.bind(null, expectation.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{formatPeriod(expectation.period)}</h2>
          <Badge variant={COMMISSION_DERIVED_STATUS_BADGE_VARIANT[expectation.derivedStatus]}>
            {COMMISSION_DERIVED_STATUS_LABELS[expectation.derivedStatus]}
          </Badge>
        </div>
        {isAdmin && expectation.status === "ACTIVE" && (
          <CancelExpectationButton id={expectation.id} />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Póliza</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Número</span>
              <Link href={`/policies/${expectation.policy.id}`} className="underline">
                {expectation.policy.policyNumber ?? "sin número"}
              </Link>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Titular</span>
              <span>
                {expectation.policy.holder.firstName} {expectation.policy.holder.lastName}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Compañía</span>
              <span>{expectation.policy.product.carrier.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Producto</span>
              <span>{expectation.policy.product.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Agente</span>
              <span>{expectation.agent?.name ?? "Sin asignar"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Montos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Esperado</span>
              <span>{formatMoney(expectation.expectedAmount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Recibido</span>
              <span>{formatMoney(expectation.receivedAmount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Diferencia</span>
              <span>{formatMoney(expectation.difference)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Movimientos</CardTitle>
        </CardHeader>
        <CardContent>
          {expectation.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos registrados todavía.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expectation.payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatReceivedAt(payment.receivedAt)}</TableCell>
                      <TableCell>{COMMISSION_PAYMENT_TYPE_LABELS[payment.type]}</TableCell>
                      <TableCell className="text-right">{formatMoney(payment.amount)}</TableCell>
                      <TableCell>{payment.externalReference ?? "—"}</TableCell>
                      <TableCell>{payment.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && expectation.status === "ACTIVE" && (
        <>
          <EditExpectationForm
            action={updateAction}
            expectedAmount={expectation.expectedAmount.toString()}
            period={periodToMonthInput(expectation.period)}
            agentId={expectation.agentId ?? ""}
            activeAgents={activeAgents}
            periodEditable={expectation.payments.length === 0}
          />
          <PaymentForm action={paymentAction} />
        </>
      )}
    </div>
  );
}
