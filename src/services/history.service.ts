import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import { assertCanAccessPolicy } from "@/services/policies.service";
import { personIdSchema } from "@/schemas/person.schema";
import { policyIdSchema } from "@/schemas/policy.schema";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Lectura del Historial/Timeline — Fase 019.9 (§8, §16-§19, §26, §30-§31).
//
// Consume AuditEvent (audit.service.ts) — nunca reimplementa lógica de
// negocio, solo lee y filtra por autorización. Distinto de Note: Note
// es texto manual del agente, esto son eventos generados
// automáticamente por el sistema al ocurrir un cambio real.
// ---------------------------------------------------------------------------

// Categorías para los filtros simples del timeline (§18) — un mapeo de
// UI a `entityType`, no un sistema de reporting. "PremiumTracking" y
// "HouseholdMember" no son tablas Prisma reales — son etiquetas de
// categorización usadas solo en `entityType` de AuditEvent para poder
// filtrar acciones que en realidad viven sobre `Policy`/`Household`.
export const HISTORY_CATEGORIES = {
  CONTACT: ["Person"],
  FAMILY: ["Household", "HouseholdMember"],
  POLICIES: ["Policy", "PolicyMember"],
  HEALTH: ["HealthPolicyDetail", "PersonMedication", "PersonProvider"],
  TASKS: ["Task"],
  NOTES: ["Note"],
  PREMIUMS: ["PremiumTracking"],
  COMMISSIONS: ["CommissionRule", "CommissionExpectation", "CommissionPayment"],
  DOCUMENTS: ["PolicyDocument"],
} as const satisfies Record<string, readonly string[]>;

export type HistoryCategory = keyof typeof HISTORY_CATEGORIES;
export const HISTORY_CATEGORY_VALUES = Object.keys(HISTORY_CATEGORIES) as HistoryCategory[];

// Comisiones es FINANCIERO/RESTRINGIDO (Fase 016) — ASSISTANT no tiene
// ningún acceso, ni siquiera de lectura, ni siquiera en el timeline de
// un contacto al que sí puede ver el resto de la información (§16, §26).
const COMMISSION_ENTITY_TYPES: readonly string[] = HISTORY_CATEGORIES.COMMISSIONS;

const historyEventSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  summary: true,
  changes: true,
  actorType: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.AuditEventSelect;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

function resolvePageSize(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

function assistantExclusionWhere(actor: AuthorizedUser): Prisma.AuditEventWhereInput {
  return actor.role === "ASSISTANT" ? { entityType: { notIn: [...COMMISSION_ENTITY_TYPES] } } : {};
}

function categoryWhere(category?: HistoryCategory): Prisma.AuditEventWhereInput {
  if (!category) return {};
  return { entityType: { in: [...HISTORY_CATEGORIES[category]] } };
}

export interface HistoryPage {
  events: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    changes: unknown;
    actorType: "USER" | "SYSTEM";
    createdAt: Date;
    actor: { id: string; name: string } | null;
  }>;
  nextCursor: string | null;
}

// Timeline de un contacto — agrega eventos de Person, Household,
// Policy, PolicyMember, Health*, Medicamentos, Proveedores, Tareas,
// Notas, Primas, Comisiones y Documentos, siempre que
// `contactPersonId` se haya guardado en el AuditEvent (ver cada
// servicio para qué eventos llevan esa clave). Autorización: la misma
// regla de "puedo editar este contacto" (ADMIN/ASSISTANT sin
// restricción, AGENT solo con acceso) — más estricta que ver el perfil
// básico, consistente con el resto de información sensible del
// contacto (Salud, ver Fase 019.8).
export async function getContactTimeline(
  actor: AuthorizedUser,
  rawPersonId: unknown,
  options?: { cursor?: string; limit?: number; category?: HistoryCategory }
): Promise<HistoryPage> {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }

  // El timeline de un contacto también incluye eventos a nivel de
  // Household (ej. "Dirección actualizada") que se registran con
  // householdId pero SIN contactPersonId — evita duplicar el mismo
  // evento una vez por cada miembro del hogar (ver docs/AUDIT_TRAIL.md).
  const householdIds = (
    await prisma.householdMember.findMany({ where: { personId }, select: { householdId: true } })
  ).map((h) => h.householdId);

  const limit = resolvePageSize(options?.limit);
  const where: Prisma.AuditEventWhereInput = {
    OR: [{ contactPersonId: personId }, ...(householdIds.length > 0 ? [{ householdId: { in: householdIds } }] : [])],
    ...assistantExclusionWhere(actor),
    ...categoryWhere(options?.category),
  };

  const rows = await prisma.auditEvent.findMany({
    where,
    select: historyEventSelect,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
}

// Timeline de una póliza específica — mismos AuditEvent que el
// timeline del contacto, filtrados por policyId en vez de
// contactPersonId (nunca se duplican eventos, es la misma tabla).
export async function getPolicyTimeline(
  actor: AuthorizedUser,
  rawPolicyId: unknown,
  options?: { cursor?: string; limit?: number }
): Promise<HistoryPage> {
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: {
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  const limit = resolvePageSize(options?.limit);
  const where: Prisma.AuditEventWhereInput = {
    policyId,
    ...assistantExclusionWhere(actor),
  };

  const rows = await prisma.auditEvent.findMany({
    where,
    select: historyEventSelect,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
}

// "Última actividad" del resumen de contacto (§30) — el evento más
// reciente, o null si todavía no hay ninguno (contacto recién creado
// antes de que exista siquiera el evento CONTACT_CREATE, caso teórico).
export async function getLastActivityForPerson(actor: AuthorizedUser, rawPersonId: unknown) {
  const page = await getContactTimeline(actor, rawPersonId, { limit: 1 });
  return page.events[0] ?? null;
}

// "Ver actividad" de un usuario — Fase 020 (§2). ADMIN only: ver la
// actividad de otro usuario es en sí una operación administrativa,
// nunca abierta como el resto del historial.
export async function getUserActivity(
  actor: AuthorizedUser,
  targetUserId: string,
  options?: { cursor?: string; limit?: number }
): Promise<HistoryPage> {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede ver la actividad de un usuario.");
  }
  const limit = resolvePageSize(options?.limit);
  const rows = await prisma.auditEvent.findMany({
    where: { actorUserId: targetUserId },
    select: historyEventSelect,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
}
