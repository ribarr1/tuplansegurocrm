import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";

// Solo para uso administrativo (ej. selector de "agente asignado" al
// crear/editar un contacto). No expone email ni otros campos.
export async function listActiveAgents(actor: AuthorizedUser) {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo ADMIN puede consultar la lista de agentes.");
  }
  return prisma.user.findMany({
    where: { role: "AGENT", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
