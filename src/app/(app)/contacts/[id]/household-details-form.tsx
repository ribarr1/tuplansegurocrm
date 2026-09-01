"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess, FieldError } from "@/components/ui/form-feedback";
import { updateHouseholdAction, type HouseholdFormState } from "../household-actions";

export type HouseholdDetailsDefaults = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  annualHouseholdIncome: string;
  incomeYear: string;
};

// Dirección + ingreso familiar del hogar — Fase 019.5. Nunca edita
// campos de Person ni de Policy desde aquí.
export function HouseholdDetailsForm({
  householdId,
  personId,
  defaults,
}: {
  householdId: string;
  personId: string;
  defaults: HouseholdDetailsDefaults;
}) {
  const action = updateHouseholdAction.bind(null, householdId, personId);
  const [state, formAction, isPending] = useActionState<HouseholdFormState, FormData>(action, undefined);
  const values = state?.values ?? defaults;
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
      <h4 className="text-sm font-medium">Dirección e ingreso familiar</h4>
      <FormError message={state?.error} />
      {state?.success && <FormSuccess message="Datos del hogar guardados correctamente." />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="addressLine1">Dirección</Label>
          <Input
            id="addressLine1"
            name="addressLine1"
            defaultValue={values.addressLine1 ?? ""}
            aria-invalid={!!state?.fieldErrors?.addressLine1}
            aria-describedby={state?.fieldErrors?.addressLine1 ? "addressLine1-error" : undefined}
          />
          <FieldError id="addressLine1-error" message={state?.fieldErrors?.addressLine1} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="addressLine2">Dirección (línea 2)</Label>
          <Input id="addressLine2" name="addressLine2" defaultValue={values.addressLine2 ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="city">Ciudad</Label>
          <Input id="city" name="city" defaultValue={values.city ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="state">Estado</Label>
          <Input
            id="state"
            name="state"
            maxLength={2}
            placeholder="Ej. IL"
            defaultValue={values.state ?? ""}
            aria-invalid={!!state?.fieldErrors?.state}
            aria-describedby={state?.fieldErrors?.state ? "state-error" : undefined}
          />
          <FieldError id="state-error" message={state?.fieldErrors?.state} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="zipCode">ZIP</Label>
          <Input id="zipCode" name="zipCode" defaultValue={values.zipCode ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="county">Condado</Label>
          <Input id="county" name="county" defaultValue={values.county ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="annualHouseholdIncome">Ingreso familiar estimado</Label>
          <Input
            id="annualHouseholdIncome"
            name="annualHouseholdIncome"
            placeholder="Ej. 72000.00"
            defaultValue={values.annualHouseholdIncome ?? ""}
            aria-invalid={!!state?.fieldErrors?.annualHouseholdIncome}
            aria-describedby={state?.fieldErrors?.annualHouseholdIncome ? "income-error" : undefined}
          />
          <FieldError id="income-error" message={state?.fieldErrors?.annualHouseholdIncome} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="incomeYear">Año del ingreso</Label>
          <Input
            id="incomeYear"
            name="incomeYear"
            placeholder="Ej. 2027"
            defaultValue={values.incomeYear ?? ""}
            aria-invalid={!!state?.fieldErrors?.incomeYear}
            aria-describedby={state?.fieldErrors?.incomeYear ? "incomeYear-error" : undefined}
          />
          <FieldError id="incomeYear-error" message={state?.fieldErrors?.incomeYear} />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
