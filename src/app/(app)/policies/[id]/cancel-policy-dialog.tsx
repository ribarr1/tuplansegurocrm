"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { USDateInput } from "@/components/ui/us-date-input";
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
import { cancelPolicyAction } from "../actions";

// Cancelación guiada — Fase 020 (§4). Nunca borra la póliza, nunca
// toca members/documents/comisiones/notas — solo status y
// terminationDate (ver policies.service.ts::cancelPolicy).
export function CancelPolicyDialog({ policyId }: { policyId: string }) {
  const [open, setOpen] = useState(false);
  const action = cancelPolicyAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Fase 025 (Hallazgo #4 de UAT, Parte D): color = destructive
          (rojo, token del sistema) — nunca un hex hardcodeado. */}
      <DialogTrigger render={<Button variant="destructive" />}>Cancelar póliza</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar póliza</DialogTitle>
          <DialogDescription>
            La póliza pasará a estado Cancelada. Miembros, documentos, información de salud, comisiones y
            notas se conservan sin cambios.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <FormError message={state?.error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="cancel-terminationDate">Fecha de terminación (MM/DD/AAAA)</Label>
            <USDateInput id="cancel-terminationDate" name="terminationDate" required />
            <FieldError message={state?.fieldErrors?.terminationDate} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
            <textarea
              id="cancel-reason"
              name="reason"
              maxLength={500}
              rows={3}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
            <FieldError message={state?.fieldErrors?.reason} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
