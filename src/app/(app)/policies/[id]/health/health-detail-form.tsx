"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HealthDetailFormState } from "./form-helpers";

export type HealthDetailFormDefaultValues = {
  marketplaceApplicationId?: string;
  marketplaceState?: string;
  planNameSnapshot?: string;
  taxCreditAmount?: string;
  incomeUsed?: string;
  deductibleIndividual?: string;
  deductibleFamily?: string;
  outOfPocketIndividual?: string;
  outOfPocketFamily?: string;
};

export function HealthDetailForm({
  action,
  defaultValues,
  // ASSISTANT nunca recibe estos campos del servidor (getHealthPolicyDetail
  // los redacta) y no debe poder enviarlos tampoco — showFinancialFields
  // en false directamente omite los inputs del formulario, no solo los
  // deshabilita. La autoridad real sigue siendo el servicio
  // (health-policies.service.ts), esto es solo para no tentar un envío
  // que de todas formas sería rechazado.
  showFinancialFields,
  submitLabel,
}: {
  action: (state: HealthDetailFormState, formData: FormData) => Promise<HealthDetailFormState>;
  defaultValues?: HealthDetailFormDefaultValues;
  showFinancialFields: boolean;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? defaultValues ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-2xl flex-col gap-6">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Marketplace</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="marketplaceApplicationId">Application ID</Label>
            <Input
              id="marketplaceApplicationId"
              name="marketplaceApplicationId"
              defaultValue={values.marketplaceApplicationId ?? ""}
            />
            {state?.fieldErrors?.marketplaceApplicationId && (
              <p className="text-sm text-destructive">
                {state.fieldErrors.marketplaceApplicationId}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="marketplaceState">Estado (2 letras)</Label>
            <Input
              id="marketplaceState"
              name="marketplaceState"
              maxLength={2}
              placeholder="Ej. IL"
              defaultValue={values.marketplaceState ?? ""}
            />
            {state?.fieldErrors?.marketplaceState && (
              <p className="text-sm text-destructive">{state.fieldErrors.marketplaceState}</p>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Plan</h3>
        <div className="flex flex-col gap-1">
          <Label htmlFor="planNameSnapshot">Nombre del plan</Label>
          <Input
            id="planNameSnapshot"
            name="planNameSnapshot"
            defaultValue={values.planNameSnapshot ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Se guarda tal como lo escribas — no se actualiza automáticamente si el producto
            cambia de nombre después.
          </p>
          {state?.fieldErrors?.planNameSnapshot && (
            <p className="text-sm text-destructive">{state.fieldErrors.planNameSnapshot}</p>
          )}
        </div>
      </section>

      {showFinancialFields && (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="text-sm font-medium">Financiero Marketplace</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="taxCreditAmount">Crédito fiscal</Label>
              <Input
                id="taxCreditAmount"
                name="taxCreditAmount"
                placeholder="Ej. 350.00"
                defaultValue={values.taxCreditAmount ?? ""}
              />
              {state?.fieldErrors?.taxCreditAmount && (
                <p className="text-sm text-destructive">{state.fieldErrors.taxCreditAmount}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="incomeUsed">Ingreso utilizado</Label>
              <Input
                id="incomeUsed"
                name="incomeUsed"
                placeholder="Ej. 42000.00"
                defaultValue={values.incomeUsed ?? ""}
              />
              {state?.fieldErrors?.incomeUsed && (
                <p className="text-sm text-destructive">{state.fieldErrors.incomeUsed}</p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Cost sharing</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="deductibleIndividual">Deducible individual</Label>
            <Input
              id="deductibleIndividual"
              name="deductibleIndividual"
              placeholder="Ej. 1500.00"
              defaultValue={values.deductibleIndividual ?? ""}
            />
            {state?.fieldErrors?.deductibleIndividual && (
              <p className="text-sm text-destructive">{state.fieldErrors.deductibleIndividual}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="deductibleFamily">Deducible familiar</Label>
            <Input
              id="deductibleFamily"
              name="deductibleFamily"
              placeholder="Ej. 3000.00"
              defaultValue={values.deductibleFamily ?? ""}
            />
            {state?.fieldErrors?.deductibleFamily && (
              <p className="text-sm text-destructive">{state.fieldErrors.deductibleFamily}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="outOfPocketIndividual">Out-of-pocket individual</Label>
            <Input
              id="outOfPocketIndividual"
              name="outOfPocketIndividual"
              placeholder="Ej. 6000.00"
              defaultValue={values.outOfPocketIndividual ?? ""}
            />
            {state?.fieldErrors?.outOfPocketIndividual && (
              <p className="text-sm text-destructive">
                {state.fieldErrors.outOfPocketIndividual}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="outOfPocketFamily">Out-of-pocket familiar</Label>
            <Input
              id="outOfPocketFamily"
              name="outOfPocketFamily"
              placeholder="Ej. 12000.00"
              defaultValue={values.outOfPocketFamily ?? ""}
            />
            {state?.fieldErrors?.outOfPocketFamily && (
              <p className="text-sm text-destructive">{state.fieldErrors.outOfPocketFamily}</p>
            )}
          </div>
        </div>
      </section>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
