"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USDateInput } from "@/components/ui/us-date-input";
import { US_STATES } from "@/lib/us-states";
import { createAgentLicenseAction } from "./actions";

export function CreateLicenseForm({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(
    createAgentLicenseAction.bind(null, userId),
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border p-4">
      {state?.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="state">Estado</Label>
        <select
          id="state"
          name="state"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          required
        >
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.state && (
          <p className="text-sm text-destructive">{state.fieldErrors.state}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="licenseNumber">Número de licencia (opcional)</Label>
        <Input id="licenseNumber" name="licenseNumber" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="effectiveDate">Fecha efectiva (opcional)</Label>
        <USDateInput id="effectiveDate" name="effectiveDate" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="expirationDate">Fecha de vencimiento (opcional)</Label>
        <USDateInput id="expirationDate" name="expirationDate" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Agregar licencia"}
      </Button>
    </form>
  );
}
