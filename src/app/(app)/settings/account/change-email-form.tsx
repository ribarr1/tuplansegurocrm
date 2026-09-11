"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestEmailChangeAction } from "./actions";

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, isPending] = useActionState(requestEmailChangeAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Correo actual: {currentEmail}</p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.success && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Enviamos un correo de confirmación a la nueva dirección. El cambio no se aplica hasta que lo confirmes desde
          ahí.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="currentPassword-email">Contraseña actual</Label>
        <Input id="currentPassword-email" name="currentPassword" type="password" autoComplete="current-password" required />
        {state?.fieldErrors?.currentPassword && (
          <p className="text-sm text-destructive">{state.fieldErrors.currentPassword}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="newEmail">Correo nuevo</Label>
        <Input id="newEmail" name="newEmail" type="email" autoComplete="off" required />
        {state?.fieldErrors?.newEmail && <p className="text-sm text-destructive">{state.fieldErrors.newEmail}</p>}
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Enviando…" : "Solicitar cambio de correo"}
      </Button>
    </form>
  );
}
