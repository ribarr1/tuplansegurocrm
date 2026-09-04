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
import { resetUserPasswordAction } from "./actions";

// Fase 022 (Hallazgo #4 de UAT) — Restablecer contraseña. Nunca
// muestra ni recupera la contraseña actual: el ADMIN escribe una
// nueva directamente (a diferencia de CreateUserForm, que sí muestra
// una temporal generada automáticamente una sola vez).
export function ResetPasswordDialog({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const action = resetUserPasswordAction.bind(null, userId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Restablecer contraseña</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Restablecer contraseña</DialogTitle>
          <DialogDescription>
            Establece una nueva contraseña para {userName}. Nunca se muestra la contraseña actual.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <FormError message={state?.error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="newPassword">Nueva contraseña</Label>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
            <FieldError message={state?.fieldErrors?.newPassword} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
            <FieldError message={state?.fieldErrors?.confirmPassword} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Restablecer contraseña"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
