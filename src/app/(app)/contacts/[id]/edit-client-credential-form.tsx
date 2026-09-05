"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLIENT_PORTAL_TYPE_VALUES } from "@/schemas/credential-vault.schema";
import { CLIENT_PORTAL_TYPE_LABELS } from "@/lib/labels";
import { updateClientPortalCredentialAction } from "./credentials-actions";

// Fase 025.3 (Bloque C): mismo contrato que edit-credential-form.tsx
// (vault de agente) — username/password nunca se precargan, un valor
// en blanco al guardar conserva el secreto cifrado actual.
export function EditClientCredentialForm({
  credentialId,
  personId,
  portalType,
  portalName,
  portalUrl,
  onDone,
}: {
  credentialId: string;
  personId: string;
  portalType: string;
  portalName: string;
  portalUrl: string;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    updateClientPortalCredentialAction.bind(null, credentialId, personId),
    undefined
  );

  useEffect(() => {
    if (state && !state.error && !state.fieldErrors) {
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border bg-muted/20 p-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`edit-portalType-${credentialId}`}>Tipo de portal</Label>
          <select
            id={`edit-portalType-${credentialId}`}
            name="portalType"
            defaultValue={portalType}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            {CLIENT_PORTAL_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {CLIENT_PORTAL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`edit-portalName-${credentialId}`}>Nombre del portal</Label>
          <Input id={`edit-portalName-${credentialId}`} name="portalName" defaultValue={portalName} required />
          {state?.fieldErrors?.portalName && (
            <p className="text-sm text-destructive">{state.fieldErrors.portalName}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`edit-portalUrl-${credentialId}`}>URL del portal</Label>
          <Input id={`edit-portalUrl-${credentialId}`} name="portalUrl" defaultValue={portalUrl} required />
          {state?.fieldErrors?.portalUrl && (
            <p className="text-sm text-destructive">{state.fieldErrors.portalUrl}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`edit-username-${credentialId}`}>Nuevo usuario (dejar en blanco para conservar)</Label>
          <Input id={`edit-username-${credentialId}`} name="username" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`edit-password-${credentialId}`}>Nueva contraseña (dejar en blanco para conservar)</Label>
          <Input id={`edit-password-${credentialId}`} name="password" type="password" autoComplete="off" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="w-fit">
          {isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
