"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createNote } from "@/services/notes.service";
import { AppError } from "@/services/errors";

export type NoteFormState = { error?: string; success?: true } | undefined;

export async function createNoteAction(
  personId: string,
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const actor = await requireSessionUser();
  const content = String(formData.get("content") ?? "");

  try {
    await createNote(actor, { personId, content });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}
