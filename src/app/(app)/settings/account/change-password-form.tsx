"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changeOwnPasswordAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.success && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Contraseña actualizada. Tus demás sesiones activas se cerraron.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="currentPassword">Contraseña actual</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
        {state?.fieldErrors?.currentPassword && (
          <p className="text-sm text-destructive">{state.fieldErrors.currentPassword}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="newPassword">Contraseña nueva</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} />
        {state?.fieldErrors?.newPassword && <p className="text-sm text-destructive">{state.fieldErrors.newPassword}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="confirmPassword">Confirmar contraseña nueva</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} />
        {state?.fieldErrors?.confirmPassword && (
          <p className="text-sm text-destructive">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
