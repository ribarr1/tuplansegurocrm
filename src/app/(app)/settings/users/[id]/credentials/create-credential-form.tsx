"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAgentPortalCredentialAction } from "./actions";

export function CreateCredentialForm({
  userId,
  carriers,
}: {
  userId: string;
  carriers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    createAgentPortalCredentialAction.bind(null, userId),
    undefined
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        + Agregar acceso
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="carrierId">Compañía (opcional)</Label>
          <select
            id="carrierId"
            name="carrierId"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="portalName">Nombre del portal</Label>
          <Input id="portalName" name="portalName" required />
          {state?.fieldErrors?.portalName && (
            <p className="text-sm text-destructive">{state.fieldErrors.portalName}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="portalUrl">URL del portal</Label>
          <Input id="portalUrl" name="portalUrl" placeholder="https://" required />
          {state?.fieldErrors?.portalUrl && (
            <p className="text-sm text-destructive">{state.fieldErrors.portalUrl}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="username">Usuario</Label>
          <Input id="username" name="username" autoComplete="off" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="off" required />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="w-fit">
          {isPending ? "Guardando…" : "Guardar acceso"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
