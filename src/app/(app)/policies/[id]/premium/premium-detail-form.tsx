"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BILLING_FREQUENCY_VALUES, PAYMENT_STATUS_VALUES } from "@/schemas/policy.schema";
import { BILLING_FREQUENCY_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import type { PremiumFormState } from "./form-helpers";

export type PremiumFormDefaultValues = {
  premiumAmount?: string;
  billingFrequency?: string;
  nextPaymentDueDate?: string;
  paymentStatus?: string;
  autopay?: boolean;
  needsPaymentAssistance?: boolean;
};

// Solo estos 6 campos — nunca policyNumber/status/producto/etc. (ver
// docs/DECISIONS.md, Fase 017).
export function PremiumDetailForm({
  action,
  defaultValues,
}: {
  action: (state: PremiumFormState, formData: FormData) => Promise<PremiumFormState>;
  defaultValues: PremiumFormDefaultValues;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  const autopayChecked = state ? values.autopay === "true" : (defaultValues.autopay ?? false);
  const assistanceChecked = state
    ? values.needsPaymentAssistance === "true"
    : (defaultValues.needsPaymentAssistance ?? false);

  return (
    <form key={formKey} action={formAction} className="flex max-w-xl flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="premiumAmount">Prima</Label>
          <Input
            id="premiumAmount"
            name="premiumAmount"
            placeholder="Ej. 125.50"
            defaultValue={values.premiumAmount ?? defaultValues.premiumAmount ?? ""}
          />
          {state?.fieldErrors?.premiumAmount && (
            <p className="text-sm text-destructive">{state.fieldErrors.premiumAmount}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="billingFrequency">Frecuencia de pago</Label>
          <select
            id="billingFrequency"
            name="billingFrequency"
            defaultValue={values.billingFrequency ?? defaultValues.billingFrequency ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin definir</option>
            {BILLING_FREQUENCY_VALUES.map((freq) => (
              <option key={freq} value={freq}>
                {BILLING_FREQUENCY_LABELS[freq]}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.billingFrequency && (
            <p className="text-sm text-destructive">{state.fieldErrors.billingFrequency}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="nextPaymentDueDate">Próxima fecha de pago</Label>
          <Input
            id="nextPaymentDueDate"
            name="nextPaymentDueDate"
            type="date"
            defaultValue={values.nextPaymentDueDate ?? defaultValues.nextPaymentDueDate ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            No se calcula automáticamente a partir de la frecuencia — se ajusta manualmente.
          </p>
          {state?.fieldErrors?.nextPaymentDueDate && (
            <p className="text-sm text-destructive">{state.fieldErrors.nextPaymentDueDate}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentStatus">Estado de pago</Label>
          <select
            id="paymentStatus"
            name="paymentStatus"
            defaultValue={values.paymentStatus ?? defaultValues.paymentStatus ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin definir</option>
            {PAYMENT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {PAYMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.paymentStatus && (
            <p className="text-sm text-destructive">{state.fieldErrors.paymentStatus}</p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autopay" defaultChecked={autopayChecked} />
        Autopay activo
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="needsPaymentAssistance" defaultChecked={assistanceChecked} />
        Requiere asistencia de pago
      </label>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Guardar seguimiento de pago"}
      </Button>
    </form>
  );
}
