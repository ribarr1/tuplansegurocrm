"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMMISSION_PAYMENT_TYPE_VALUES } from "@/schemas/commission.schema";
import { COMMISSION_PAYMENT_TYPE_LABELS } from "@/lib/labels";
import type { CommissionFormState } from "../form-helpers";

// El signo final de amount lo decide el servicio, no este formulario —
// por eso el usuario siempre escribe un monto "amigable": positivo
// para PAYMENT/CHARGEBACK, con signo explícito solo para ADJUSTMENT
// (ver normalizePaymentAmount en commissions.service.ts).
export function PaymentForm({
  action,
}: {
  action: (state: CommissionFormState, formData: FormData) => Promise<CommissionFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-sm font-medium">Registrar movimiento</h3>
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="type">Tipo</Label>
          <select
            id="type"
            name="type"
            defaultValue={values.type ?? "PAYMENT"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {COMMISSION_PAYMENT_TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {COMMISSION_PAYMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.type && (
            <p className="text-sm text-destructive">{state.fieldErrors.type}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="amount">Monto</Label>
          <Input
            id="amount"
            name="amount"
            placeholder="Ej. 125.50 (un ajuste puede llevar signo: -50.00)"
            required
            defaultValue={values.amount ?? ""}
          />
          {state?.fieldErrors?.amount && (
            <p className="text-sm text-destructive">{state.fieldErrors.amount}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="receivedAt">Fecha</Label>
          <Input id="receivedAt" name="receivedAt" type="datetime-local" required defaultValue={values.receivedAt ?? ""} />
          {state?.fieldErrors?.receivedAt && (
            <p className="text-sm text-destructive">{state.fieldErrors.receivedAt}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="externalReference">Referencia (opcional)</Label>
          <Input
            id="externalReference"
            name="externalReference"
            defaultValue={values.externalReference ?? ""}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <Input id="notes" name="notes" defaultValue={values.notes ?? ""} />
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Registrar movimiento"}
      </Button>
    </form>
  );
}
