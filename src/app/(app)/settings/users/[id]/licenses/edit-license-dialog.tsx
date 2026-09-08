"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USDateInput } from "@/components/ui/us-date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateAgentLicenseAction } from "./actions";

// CORRECCIÓN (editar licencias): número de licencia/fecha
// efectiva/fecha de vencimiento son editables — el estado geográfico
// NUNCA (se muestra de solo lectura; updateAgentLicenseSchema ni
// siquiera acepta ese campo).
export function EditLicenseDialog({
  licenseId,
  userId,
  state,
  licenseNumber,
  effectiveDateIso,
  expirationDateIso,
}: {
  licenseId: string;
  userId: string;
  state: string;
  licenseNumber: string | null;
  effectiveDateIso: string | null;
  expirationDateIso: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateAgentLicenseAction(licenseId, userId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Editar</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar licencia — {state}</DialogTitle>
          <DialogDescription>El estado geográfico no puede cambiarse aquí.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`licenseNumber-${licenseId}`}>Número de licencia</Label>
            <Input id={`licenseNumber-${licenseId}`} name="licenseNumber" defaultValue={licenseNumber ?? ""} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`effectiveDate-${licenseId}`}>Fecha efectiva</Label>
            <USDateInput id={`effectiveDate-${licenseId}`} name="effectiveDate" defaultValue={effectiveDateIso} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`expirationDate-${licenseId}`}>Fecha de vencimiento</Label>
            <USDateInput id={`expirationDate-${licenseId}`} name="expirationDate" defaultValue={expirationDateIso} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
