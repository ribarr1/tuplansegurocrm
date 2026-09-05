"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAgentPortalCredentialAction } from "./actions";

// Fase 025.3 (Bloque C): la edición NUNCA precarga username/password
// reales — los campos de reemplazo siempre inician vacíos. Vacío al
// guardar significa "conservar el valor cifrado actual" (ver actions.ts,
// emptyToOmitted); un valor nuevo explícito significa "reemplazar y
// volver a cifrar". El servidor nunca descifra el secreto solo para
// llenar este formulario.
export function EditCredentialForm({
  credentialId,
  userId,
  carrierId,
  portalName,
  portalUrl,
  carriers,
  onDone,
}: {
  credentialId: string;
  userId: string;
  carrierId: string | null;
  portalName: string;
  portalUrl: string;
  carriers: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    updateAgentPortalCredentialAction.bind(null, credentialId, userId),
    undefined
  );

  // updateAgentPortalCredentialAction no redirige (a diferencia de las
  // páginas de Policy) — success se detecta por ausencia de error tras
  // un submit, mismo criterio que el resto de esta pantalla
  // (revalidatePath ya refresca los datos mostrados).
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
          <Label htmlFor={`edit-carrierId-${credentialId}`}>Compañía (opcional)</Label>
          <select
            id={`edit-carrierId-${credentialId}`}
            name="carrierId"
            defaultValue={carrierId ?? ""}
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
