import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { parseOrThrow } from "@/services/errors";
import { policyAgentAccessWhere } from "@/services/policies.service";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Buscador global — Fase 019.9 (§6, §26). Contactos por
// nombre/apellido/email/teléfono; Pólizas por número de póliza (además
// de carrier/producto, ya disponibles vía sus relaciones).
//
// Autorización — nota de auditoría explícita:
// Contactos: se usa la MISMA política ya establecida desde Fase 008
// para ver/listar personas — CUALQUIER usuario activo (ADMIN, AGENT,
// ASSISTANT) puede ver cualquier contacto; solo EDITAR está acotado
// por asignación (canEditPerson, people.service.ts). El buscador nunca
// introduce una restricción de visibilidad nueva que no exista ya en
// /contacts — hacerlo crearía una inconsistencia confusa (oculto en
// la búsqueda pero visible entrando directo a la URL). Si en el futuro
// se decide que un AGENT no debe poder ver contactos de otro agente,
// esa es una decisión de alcance mayor sobre TODO el módulo de
// Contactos, no algo que deba resolverse solo aquí — ver
// docs/DECISIONS.md.
// Pólizas: SÍ usa la política real ya existente (policyAgentAccessWhere)
// — un AGENT nunca ve en resultados una póliza fuera de su acceso.
// ---------------------------------------------------------------------------

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Escribe algo para buscar.").max(200),
});

const contactResultSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  contactStatus: true,
} satisfies Prisma.PersonSelect;

const policyResultSelect = {
  id: true,
  policyNumber: true,
  status: true,
  holder: { select: { id: true, firstName: true, lastName: true } },
  product: { select: { name: true, carrier: { select: { name: true } } } },
} satisfies Prisma.PolicySelect;

const MAX_RESULTS_PER_TYPE = 10;

export async function globalSearch(actor: AuthorizedUser, rawQuery: unknown) {
  const { q } = parseOrThrow(searchQuerySchema, rawQuery);

  const contactsWhere: Prisma.PersonWhereInput = {
    OR: [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ],
  };

  const agentWhere = policyAgentAccessWhere(actor);
  const policiesWhere: Prisma.PolicyWhereInput = {
    AND: [
      {
        OR: [
          { policyNumber: { contains: q, mode: "insensitive" } },
          { product: { name: { contains: q, mode: "insensitive" } } },
          { product: { carrier: { name: { contains: q, mode: "insensitive" } } } },
        ],
      },
      ...(agentWhere ? [agentWhere] : []),
    ],
  };

  // Dos findMany independientes (nunca $transaction([...]) — ver
  // docs/DECISIONS.md, "Advertencia de concurrencia pg" de Fase 019.6:
  // el array-form fija ambas queries a una sola conexión y cada una ya
  // selecciona relaciones, exactamente el patrón que dispara el
  // warning real de pg).
  const [contacts, policies] = await Promise.all([
    prisma.person.findMany({
      where: contactsWhere,
      select: contactResultSelect,
      take: MAX_RESULTS_PER_TYPE,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.policy.findMany({
      where: policiesWhere,
      select: policyResultSelect,
      take: MAX_RESULTS_PER_TYPE,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { contacts, policies };
}
