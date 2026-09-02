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
import { createMedicationAction, updateMedicationAction } from "./health-records-actions";

export type MedicationRecord = {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  notes: string | null;
};

// Hallazgo #18 de UAT (Fase 019.8): un solo diálogo para crear/editar —
// name es obligatorio, dosage/frequency/notes son opcionales (el agente
// puede escribir solo lo que sabe). V1 enteramente manual, diseñado
// para que un futuro catálogo de medicamentos/posologías pueda
// integrarse sin romper este formulario (ver docs/DECISIONS.md).
export function MedicationDialog({
  personId,
  medication,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "sm",
}: {
  personId: string;
  medication?: MedicationRecord;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const action = medication
    ? updateMedicationAction.bind(null, medication.id, personId)
    : createMedicationAction.bind(null, personId);
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
          <DialogTitle>{medication ? "Editar medicamento" : "Agregar medicamento"}</DialogTitle>
          <DialogDescription>
            Ej. Metformin, 500 mg, 2 veces al día. Solo el nombre es obligatorio.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <FormError message={state?.error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="med-name">Nombre</Label>
            <Input id="med-name" name="name" required defaultValue={medication?.name ?? ""} />
            <FieldError message={state?.fieldErrors?.name} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="med-dosage">Dosis</Label>
            <Input
              id="med-dosage"
              name="dosage"
              placeholder="Ej. 500 mg"
              defaultValue={medication?.dosage ?? ""}
            />
            <FieldError message={state?.fieldErrors?.dosage} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="med-frequency">Frecuencia</Label>
            <Input
              id="med-frequency"
              name="frequency"
              placeholder="Ej. 2 veces al día"
              defaultValue={medication?.frequency ?? ""}
            />
            <FieldError message={state?.fieldErrors?.frequency} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="med-notes">Notas</Label>
            <Input id="med-notes" name="notes" defaultValue={medication?.notes ?? ""} />
            <FieldError message={state?.fieldErrors?.notes} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : medication ? "Guardar cambios" : "Agregar medicamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
