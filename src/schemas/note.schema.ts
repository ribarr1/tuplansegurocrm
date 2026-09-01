import { z } from "zod";

export const createNoteSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  content: z.string().trim().min(1, "La nota no puede estar vacía.").max(2000, "La nota es demasiado larga."),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
