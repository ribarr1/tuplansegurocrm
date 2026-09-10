"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activateAccountAction } from "./actions";

export function ActivateForm({ userId, token }: { userId: string; token: string }) {
  const [state, formAction, isPending] = useActionState(
    activateAccountAction.bind(null, userId, token),
    undefined
  );

  if (state && "success" in state) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-400">
          Contraseña creada. Ya puedes iniciar sesión.
        </p>
        <Button nativeButton={false} render={<Link href="/login" />}>
          Ir a iniciar sesión
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">Nueva contraseña</Label>
        <Input id="newPassword" name="newPassword" type="password" required autoComplete="new-password" />
        {state?.fieldErrors?.newPassword && (
          <p className="text-sm text-destructive">{state.fieldErrors.newPassword}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Confirma la contraseña</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" />
        {state?.fieldErrors?.confirmPassword && (
          <p className="text-sm text-destructive">{state.fieldErrors.confirmPassword}</p>
        )}
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Creando…" : "Crear contraseña"}
      </Button>
    </form>
  );
}
