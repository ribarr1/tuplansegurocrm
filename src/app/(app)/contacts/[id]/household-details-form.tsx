"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="addressLine1">Dirección</Label>
          <Input id="addressLine1" name="addressLine1" defaultValue={values.addressLine1 ?? ""} />
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
          <Input id="state" name="state" maxLength={2} placeholder="Ej. IL" defaultValue={values.state ?? ""} />
          {state?.fieldErrors?.state && <p className="text-sm text-destructive">{state.fieldErrors.state}</p>}
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
          />
          {state?.fieldErrors?.annualHouseholdIncome && (
            <p className="text-sm text-destructive">{state.fieldErrors.annualHouseholdIncome}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="incomeYear">Año del ingreso</Label>
          <Input id="incomeYear" name="incomeYear" placeholder="Ej. 2027" defaultValue={values.incomeYear ?? ""} />
          {state?.fieldErrors?.incomeYear && (
            <p className="text-sm text-destructive">{state.fieldErrors.incomeYear}</p>
          )}
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
