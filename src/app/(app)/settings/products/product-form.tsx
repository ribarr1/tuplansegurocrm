"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import type { ProductFormState } from "./form-helpers";

export type ProductFormDefaultValues = {
  carrierId?: string;
  name?: string;
  policyType?: string;
  planYear?: string;
  externalCode?: string;
  isActive?: boolean;
};

export function ProductForm({
  action,
  defaultValues,
  carriers,
  // Cuando el producto ya fue usado por al menos una Policy, carrierId /
  // policyType / planYear quedan bloqueados en la UI — la regla real
  // vive en products.service.ts (updateProduct), esto es solo
  // conveniencia: un input disabled no viaja en el FormData, así que ni
  // siquiera se intenta enviar un cambio que el servicio rechazaría.
  isUsed = false,
  submitLabel,
}: {
  action: (state: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  defaultValues?: ProductFormDefaultValues;
  carriers: { id: string; name: string }[];
  isUsed?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? defaultValues ?? {};
  const isActive =
    state?.values?.isActive !== undefined
      ? state.values.isActive === "true"
      : (defaultValues?.isActive ?? true);
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {isUsed && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Este producto ya fue usado en al menos una póliza. Compañía, tipo de seguro y año de
          plan no se pueden cambiar — crea un producto nuevo si el cambio es real.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="carrierId">Compañía</Label>
        <select
          id="carrierId"
          name="carrierId"
          defaultValue={values.carrierId ?? ""}
          disabled={isUsed}
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        >
          <option value="" disabled>
            Selecciona una compañía
          </option>
          {carriers.map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.carrierId && (
          <p className="text-sm text-destructive">{state.fieldErrors.carrierId}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="policyType">Tipo de seguro</Label>
        <select
          id="policyType"
          name="policyType"
          defaultValue={values.policyType ?? ""}
          disabled={isUsed}
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        >
          <option value="" disabled>
            Selecciona un tipo
          </option>
          {POLICY_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {POLICY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.policyType && (
          <p className="text-sm text-destructive">{state.fieldErrors.policyType}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="name">Nombre del producto</Label>
        <Input id="name" name="name" defaultValue={values.name ?? ""} required />
        {state?.fieldErrors?.name && (
          <p className="text-sm text-destructive">{state.fieldErrors.name}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="planYear">Año del plan</Label>
          <Input
            id="planYear"
            name="planYear"
            type="number"
            defaultValue={values.planYear ?? ""}
            disabled={isUsed}
            className="disabled:opacity-60"
          />
          {state?.fieldErrors?.planYear && (
            <p className="text-sm text-destructive">{state.fieldErrors.planYear}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="externalCode">Código externo</Label>
          <Input id="externalCode" name="externalCode" defaultValue={values.externalCode ?? ""} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={isActive} />
        Activo
      </label>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
