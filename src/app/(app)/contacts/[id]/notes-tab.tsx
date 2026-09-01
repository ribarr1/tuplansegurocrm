import { listNotesForPerson } from "@/services/notes.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { NoteForm } from "./note-form";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Registro operativo/informativo — NUNCA reemplaza a Task (acción
// futura). Orden: más reciente primero.
export async function NotesTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const notes = await listNotesForPerson(actor, personId);

  return (
    <div className="flex flex-col gap-4">
      <NoteForm personId={personId} />
      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay notas registradas para este contacto.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((note) => (
            <div key={note.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
              <p className="whitespace-pre-wrap">{note.content}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(note.createdAt)} · {note.createdBy?.name ?? "Usuario"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
