import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";

// Solo para uso administrativo (ej. selector de "agente asignado" al
// crear/editar un contacto, o "responsable" al crear/editar una tarea
// — Fase 014, donde ASSISTANT también necesita esta lista para poder
// asignar tareas a agentes). No expone email ni otros campos.
export async function listActiveAgents(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN" && actor.role !== "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes permiso para consultar la lista de agentes.");
  }
  return prisma.user.findMany({
    where: { role: "AGENT", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
