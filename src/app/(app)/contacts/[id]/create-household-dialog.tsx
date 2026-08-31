"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HOUSEHOLD_MEMBER_ROLE_VALUES } from "@/schemas/household.schema";
import { HOUSEHOLD_MEMBER_ROLE_LABELS } from "@/lib/labels";
import { createHouseholdAction } from "../household-actions";

export function CreateHouseholdDialog({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const action = createHouseholdAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) {
      setOpen(false);
    }
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Crear hogar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear hogar</DialogTitle>
          <DialogDescription>
            Esta persona quedará como el primer miembro del hogar.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {state?.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">Nombre del hogar (opcional)</Label>
            <Input
              id="name"
              name="name"
              placeholder="Ej. Familia Pérez"
              defaultValue={state?.values?.name}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="role">Rol de esta persona en el hogar</Label>
            <select
              id="role"
              name="role"
              defaultValue={state?.values?.role ?? "HEAD"}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {HOUSEHOLD_MEMBER_ROLE_VALUES.map((role) => (
                <option key={role} value={role}>
                  {HOUSEHOLD_MEMBER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {state?.fieldErrors?.role && (
              <p className="text-sm text-destructive">{state.fieldErrors.role}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando…" : "Crear hogar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
