import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import { personIdSchema } from "@/schemas/person.schema";
import { createNoteSchema } from "@/schemas/note.schema";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Notas — Fase 019.5
//
// Registro operativo/informativo sobre un contacto ("Prefiere WhatsApp",
// "Llamó para preguntar por su renovación") — NUNCA reemplaza a Task
// (acción futura con fecha/responsable). No promover diagnósticos
// clínicos, SSN, tarjetas ni credenciales — es texto libre, así que la
// prevención real es de proceso/entrenamiento, no de código; el límite
// de 2000 caracteres desalienta narrativa extensa.
//
// Ver: cualquier usuario activo (misma política que ver una Person,
// Fase 008 — una nota no es más sensible que el resto del contacto).
// Crear: requiere canEditPerson (misma regla que editar cualquier otro
// dato del contacto) — un AGENT solo puede anotar contactos dentro de
// su acceso.
// ---------------------------------------------------------------------------

const noteSelect = {
  id: true,
  content: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.NoteSelect;

export async function listNotesForPerson(actor: AuthorizedUser, rawPersonId: unknown) {
  void actor;
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  return prisma.note.findMany({
    where: { personId },
    select: noteSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createNote(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createNoteSchema, rawInput);

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }

  return prisma.note.create({
    data: { personId: input.personId, content: input.content, createdById: actor.id },
    select: noteSelect,
  });
}
