"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierFormState } from "./form-helpers";

export function CarrierForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (state: CarrierFormState, formData: FormData) => Promise<CarrierFormState>;
  defaultValues?: { name?: string; isActive?: boolean };
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const name = values.name ?? defaultValues?.name ?? "";
  const isActive =
    values.isActive !== undefined ? values.isActive === "true" : (defaultValues?.isActive ?? true);
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" defaultValue={name} required />
        {state?.fieldErrors?.name && (
          <p className="text-sm text-destructive">{state.fieldErrors.name}</p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={isActive} />
        Activa
      </label>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
