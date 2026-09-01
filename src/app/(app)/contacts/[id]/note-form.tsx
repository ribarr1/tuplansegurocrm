"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form-feedback";
import { createNoteAction, type NoteFormState } from "./notes-actions";

export function NoteForm({ personId }: { personId: string }) {
  const action = createNoteAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState<NoteFormState, FormData>(action, undefined);

  // Textarea controlado (no remount por key) para poder limpiarlo tras
  // un éxito SIN perder el mensaje de confirmación en el mismo golpe de
  // render — un remount inmediato descartaría state.success antes de
  // que el usuario llegue a verlo. Patrón "ajustar estado durante el
  // render" (sancionado por React) para vaciar el campo exactamente
  // una vez por cada éxito nuevo.
  const [content, setContent] = useState("");
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setContent("");
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border p-3">
      <FormError message={state?.error} />
      {state?.success && <FormSuccess message="Nota guardada correctamente." />}
      <textarea
        name="content"
        required
        maxLength={2000}
        rows={3}
        placeholder="Ej. Prefiere contacto por WhatsApp."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Agregar nota"}
      </Button>
    </form>
  );
}
