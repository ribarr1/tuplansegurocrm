"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FieldError } from "@/components/ui/form-feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PROVIDER_TYPE_VALUES } from "@/schemas/health-record.schema";
import { PROVIDER_TYPE_LABELS } from "@/lib/labels";
import type { ProviderType } from "@/generated/prisma/client";
import { createProviderAction, updateProviderAction } from "./health-records-actions";

export type ProviderRecord = {
  id: string;
  type: ProviderType;
  name: string;
  specialty: string | null;
  phone: string | null;
  organization: string | null;
  notes: string | null;
};

export function ProviderDialog({
  personId,
  provider,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "sm",
}: {
  personId: string;
  provider?: ProviderRecord;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const action = provider
    ? updateProviderAction.bind(null, provider.id, personId)
    : createProviderAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{provider ? "Editar proveedor" : "Agregar médico/proveedor"}</DialogTitle>
          <DialogDescription>Solo tipo y nombre son obligatorios.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <FormError message={state?.error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-type">Tipo</Label>
            <select
              id="prov-type"
              name="type"
              required
              defaultValue={provider?.type ?? "PCP"}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PROVIDER_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {PROVIDER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <FieldError message={state?.fieldErrors?.type} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-name">Nombre</Label>
            <Input id="prov-name" name="name" required defaultValue={provider?.name ?? ""} />
            <FieldError message={state?.fieldErrors?.name} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-specialty">Especialidad</Label>
            <Input id="prov-specialty" name="specialty" defaultValue={provider?.specialty ?? ""} />
            <FieldError message={state?.fieldErrors?.specialty} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-phone">Teléfono</Label>
            <Input id="prov-phone" name="phone" defaultValue={provider?.phone ?? ""} />
            <FieldError message={state?.fieldErrors?.phone} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-organization">Organización / consultorio</Label>
            <Input id="prov-organization" name="organization" defaultValue={provider?.organization ?? ""} />
            <FieldError message={state?.fieldErrors?.organization} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prov-notes">Notas</Label>
            <Input id="prov-notes" name="notes" defaultValue={provider?.notes ?? ""} />
            <FieldError message={state?.fieldErrors?.notes} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : provider ? "Guardar cambios" : "Agregar proveedor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
