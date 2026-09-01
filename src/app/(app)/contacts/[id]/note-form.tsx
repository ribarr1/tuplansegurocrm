"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { createNoteAction, type NoteFormState } from "./notes-actions";

export function NoteForm({ personId }: { personId: string }) {
  const action = createNoteAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState<NoteFormState, FormData>(action, undefined);
  // Remonta el formulario SOLO tras un éxito — limpia el textarea, ya
  // que esta acción no redirige (a diferencia de otros formularios de
  // la app). En error se preserva el borrador para poder corregirlo.
  // Patrón "ajustar estado durante el render" (sancionado por React,
  // ver "You Might Not Need an Effect") en vez de un useEffect, para no
  // disparar un render en cascada.
  const [prevState, setPrevState] = useState(state);
  const [resetCount, setResetCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setResetCount((c) => c + 1);
  }

  return (
    <form key={resetCount} action={formAction} className="flex flex-col gap-2 rounded-md border p-3">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}
      <textarea
        name="content"
        required
        maxLength={2000}
        rows={3}
        placeholder="Ej. Prefiere contacto por WhatsApp."
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Agregar nota"}
      </Button>
    </form>
  );
}
