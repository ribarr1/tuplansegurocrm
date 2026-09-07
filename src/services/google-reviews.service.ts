import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  setGoogleReviewStatusSchema,
  listReviewCandidatesQuerySchema,
  listContactsWithReviewQuerySchema,
} from "@/schemas/google-review.schema";
import { UNASSIGNED_AGENT_FILTER } from "@/schemas/person.schema";
import type { Prisma, GoogleReviewStatus } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Seguimiento administrativo de reseñas de Google — Fase 025.5 (UAT-10).
//
// EXCLUSIVAMENTE administrativo: solo role=ADMIN puede ver o modificar
// esto, en cualquier capa (UI, server actions, services, exports,
// dashboard) — un ADMIN que además sea agente (Rubén) lo administra
// por su rol ADMIN, nunca por isAgent. AGENT/ASSISTANT reciben
// FORBIDDEN real, nunca un resultado vacío/redactado silenciosamente
// (mismo criterio que Comisiones, Fase 016).
//
// PENDING_REQUEST es el default de columna — NUNCA se interpreta como
// "hay que pedirle" por sí solo: listReviewCandidates aplica su propio
// filtro de elegibilidad (contactStatus=CLIENT + al menos una Policy
// propia de la agencia ACTIVE como titular) encima de ese estado, así
// que un prospecto o un cliente solo con pólizas referidas nunca
// aparece ahí aunque su estado crudo sea PENDING_REQUEST.
// ---------------------------------------------------------------------------

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar reseñas de Google.");
  }
}

const reviewSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  contactStatus: true,
  googleReviewStatus: true,
  reviewRequestedAt: true,
  reviewPublishedAt: true,
  reviewStatusUpdatedBy: { select: { id: true, name: true } },
  assignedAgent: { select: { id: true, name: true } },
} satisfies Prisma.PersonSelect;

export async function getGoogleReviewInfo(actor: AuthorizedUser, rawPersonId: unknown) {
  assertAdminOnly(actor);
  const { personId } = parseOrThrow(setGoogleReviewStatusSchema.pick({ personId: true }), {
    personId: rawPersonId,
  });
  const person = await prisma.person.findUnique({ where: { id: personId }, select: reviewSelect });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

// Al pasar a REQUESTED se actualiza reviewRequestedAt a AHORA (una
// re-solicitud posterior a una corrección también cuenta como nueva
// solicitud real). Al pasar a PUBLISHED se actualiza reviewPublishedAt
// a AHORA. Nunca se BORRAN esas fechas al salir de un estado — si el
// ADMIN corrige un estado marcado por error (ej. PUBLISHED ->
// REQUESTED), la fecha de publicación anterior se conserva como
// historial de que en algún momento se marcó así; solo una nueva
// entrada real a PUBLISHED la vuelve a actualizar.
export async function setGoogleReviewStatus(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(setGoogleReviewStatusSchema, rawInput);

  const existing = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true, googleReviewStatus: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  const data: Prisma.PersonUpdateInput = {
    googleReviewStatus: input.status,
    reviewStatusUpdatedBy: { connect: { id: actor.id } },
  };
  const now = new Date();
  if (input.status === "REQUESTED") data.reviewRequestedAt = now;
  if (input.status === "PUBLISHED") data.reviewPublishedAt = now;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.person.update({ where: { id: input.personId }, data, select: reviewSelect });
    // Nunca PII adicional en el audit log — solo el hecho del cambio de
    // estado (los nombres técnicos del enum no son sensibles).
    await recordAuditEvent(tx, {
      actor,
      entityType: "Person",
      entityId: input.personId,
      action: "GOOGLE_REVIEW_STATUS_CHANGE",
      contactPersonId: input.personId,
      summary: `Reseña de Google: ${existing.googleReviewStatus} -> ${input.status}`,
      changes: { googleReviewStatus: { before: existing.googleReviewStatus, after: input.status } },
    });
    return updated;
  });
}

// Fase 025.5: reutiliza el mismo criterio de elegibilidad en TODOS los
// lugares que lo necesiten (candidatos + contadores) — nunca duplicado.
// "Póliza propia de la agencia activa" = holderPolicies con
// status=ACTIVE y businessSource=OWN (el titular, no un PolicyMember
// cubierto — mismo alcance simple que pidió la ficha).
const ELIGIBLE_CLIENT_WHERE = {
  contactStatus: "CLIENT",
  holderPolicies: { some: { status: "ACTIVE", businessSource: "OWN" } },
} satisfies Prisma.PersonWhereInput;

export async function listReviewCandidates(actor: AuthorizedUser, rawQuery: unknown) {
  assertAdminOnly(actor);
  const { page, pageSize } = parseOrThrow(listReviewCandidatesQuerySchema, rawQuery);

  const where: Prisma.PersonWhereInput = {
    ...ELIGIBLE_CLIENT_WHERE,
    googleReviewStatus: "PENDING_REQUEST",
  };

  const [items, total] = await Promise.all([
    prisma.person.findMany({
      where,
      select: reviewSelect,
      orderBy: { lastName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.person.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

// Contadores del Dashboard/lista — Fase 025.5. "Pendientes de
// solicitar" se cuenta SOLO entre elegibles (mismo criterio que
// listReviewCandidates, nunca el crudo de PENDING_REQUEST que incluiría
// prospectos/referidos sin ninguna relación comercial real todavía).
// Solicitadas/Publicadas/No solicitar SIEMPRE fueron puestas por una
// acción explícita del ADMIN (nunca un default), así que su conteo
// crudo ya es significativo sin filtro adicional.
export async function getGoogleReviewCounts(actor: AuthorizedUser) {
  assertAdminOnly(actor);
  const [pending, requested, published, doNotRequest] = await Promise.all([
    prisma.person.count({ where: { ...ELIGIBLE_CLIENT_WHERE, googleReviewStatus: "PENDING_REQUEST" } }),
    prisma.person.count({ where: { googleReviewStatus: "REQUESTED" } }),
    prisma.person.count({ where: { googleReviewStatus: "PUBLISHED" } }),
    prisma.person.count({ where: { googleReviewStatus: "DO_NOT_REQUEST" } }),
  ]);
  return { pending, requested, published, doNotRequest };
}

export type GoogleReviewStatusValue = GoogleReviewStatus;

// Fase 025.5 (UAT-10) — decora un lote de Person (ya autorizado por
// listPeople) con su estado de reseña, SOLO para ADMIN. Nunca se
// mezcla dentro de people.service.ts (que sirve a los 3 roles) — el
// dato nunca debe poder llegar a AGENT/ASSISTANT por descuido de un
// select compartido.
export async function getReviewStatusesByIds(
  actor: AuthorizedUser,
  ids: string[]
): Promise<Map<string, GoogleReviewStatus>> {
  assertAdminOnly(actor);
  if (ids.length === 0) return new Map();
  const rows = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, googleReviewStatus: true },
  });
  return new Map(rows.map((r) => [r.id, r.googleReviewStatus]));
}

// Listado de Contactos filtrado por reviewStatus — ADMIN only. Réplica
// MÍNIMA del where de listPeople (solo 2 campos: search/contactStatus)
// porque agregarle el filtro de reseña a la función general
// contaminaría un select compartido con los otros roles; dado el
// tamaño pequeño de esa duplicación se prefiere aquí a exportar el
// where-builder de people.service.ts solo para este único caso ADMIN.
export async function listContactsWithReviewInfo(actor: AuthorizedUser, rawQuery: unknown) {
  assertAdminOnly(actor);
  const { page, pageSize, search, contactStatus, reviewStatus, assignedAgentId } = parseOrThrow(
    listContactsWithReviewQuerySchema,
    rawQuery
  );

  const where: Prisma.PersonWhereInput = {
    ...(contactStatus ? { contactStatus } : {}),
    ...(reviewStatus ? { googleReviewStatus: reviewStatus } : {}),
    ...(assignedAgentId
      ? assignedAgentId === UNASSIGNED_AGENT_FILTER
        ? { assignedAgentId: null }
        : { assignedAgentId }
      : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const listSelect = {
    id: true,
    firstName: true,
    lastName: true,
    phone: true,
    email: true,
    contactStatus: true,
    googleReviewStatus: true,
    assignedAgent: { select: { id: true, name: true } },
  } satisfies Prisma.PersonSelect;

  const [items, total] = await Promise.all([
    prisma.person.findMany({
      where,
      select: listSelect,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.person.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
