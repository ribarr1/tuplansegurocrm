"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/labels";
import { USER_ROLE_VALUES } from "@/schemas/user.schema";
import { createUserAction, type CreateUserFormState } from "./actions";

export function CreateUserForm() {
  const [state, formAction, isPending] = useActionState<CreateUserFormState, FormData>(
    createUserAction,
    undefined
  );

  // Remonta el formulario tras éxito (limpia los campos para el
  // próximo usuario) — mismo patrón "ajustar estado durante el
  // render" usado en note-form.tsx / upload-document-form.tsx.
  const [prevState, setPrevState] = useState(state);
  const [resetCount, setResetCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (state && "success" in state) setResetCount((c) => c + 1);
  }

  return (
    <div className="flex flex-col gap-3">
      {state && "success" in state && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Usuario creado: {state.email}</p>
          <p>
            Contraseña temporal (cópiala ahora — no se mostrará de nuevo):{" "}
            <code className="rounded bg-background px-1.5 py-0.5 font-mono">
              {state.temporaryPassword}
            </code>
          </p>
          <p className="text-xs text-muted-foreground">
            Compártela con el usuario por un canal seguro (no queda registrada en ningún lugar del
            sistema). El envío automático por correo aún no está implementado.
          </p>
        </div>
      )}

      <form key={resetCount} action={formAction} className="flex flex-col gap-3 rounded-md border p-3 text-sm">
        {state && "error" in state && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Nombre completo</span>
            <input
              name="name"
              required
              maxLength={200}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Correo electrónico</span>
            <input
              name="email"
              type="email"
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Rol</span>
            <select
              name="role"
              defaultValue="AGENT"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {USER_ROLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button type="submit" size="sm" disabled={isPending} className="w-fit">
          {isPending ? "Creando…" : "Crear usuario"}
        </Button>
      </form>
    </div>
  );
}
