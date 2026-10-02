import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { normalizeLeadPhone } from "@/lib/lead-phone";
import { zonedTimeToUtc, getAppTimeZone } from "@/lib/business-time";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";
import { createPerson } from "@/services/people.service";
import { createPolicy, getPolicyById } from "@/services/policies.service";
import {
  leadIdSchema,
  leadIntakeSchema,
  type LeadIntakeInput,
  createLeadManualSchema,
  updateLeadDetailsSchema,
  listLeadsQuerySchema,
  assignLeadSchema,
  updateLeadFollowUpStatusSchema,
  closeLeadSchema,
  createLeadActivitySchema,
  convertLeadSchema,
  UNASSIGNED_LEAD_FILTER,
} from "@/schemas/lead.schema";
import type { Prisma, LeadSource } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Política de acceso — Lead (Fase 026, V1)
//
// ADMIN: ve/crea/asigna/reasigna/gestiona cualquier lead.
// AGENT: ve y gestiona ÚNICAMENTE los leads actualmente asignados a él
//        (más estricto que Task: un lead SIN asignar NO es visible
//        para un AGENT — la asignación la decide el administrador).
//        Nunca asigna ni reasigna.
// ASSISTANT: sin acceso a este módulo en esta fase (bloqueado al
//        inicio de cada función exportada).
//
// Vincular un lead a una Person NO otorga acceso adicional a esa
// Person más allá del que el actor ya tenía (canEditPerson sigue
// siendo la única fuente de verdad para Person/Policy).
// ---------------------------------------------------------------------------

function assertModuleAccess(actor: AuthorizedUser): void {
  if (actor.role === "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes acceso al módulo de leads.");
  }
}

function assertAdmin(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede realizar esta acción.");
  }
}

export function canAccessLead(actor: AuthorizedUser, lead: { assignedToId: string | null }): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "AGENT") return lead.assignedToId === actor.id;
  return false;
}

function assertCanAccessLead(actor: AuthorizedUser, lead: { assignedToId: string | null }): void {
  assertModuleAccess(actor);
  if (!canAccessLead(actor, lead)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a este lead.");
  }
}

const leadListSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  residenceState: true,
  productInterest: true,
  source: true,
  campaignId: true,
  campaignName: true,
  receivedAt: true,
  stage: true,
  followUpStatus: true,
  phoneNormalized: true,
  linkedPersonId: true,
  assignedToId: true,
  assignedTo: { select: { id: true, name: true } },
  linkedPerson: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeadSelect;

const leadDetailSelect = {
  ...leadListSelect,
  closeReason: true,
  closeReasonDetail: true,
  convertedPolicyId: true,
  consentGiven: true,
  consentText: true,
  consentDate: true,
  consentSource: true,
  originalInquiryAt: true,
  externalId: true,
  formResponses: true,
  createdAt: true,
  updatedAt: true,
  integrationCredential: { select: { id: true, label: true, source: true } },
  createdBy: { select: { id: true, name: true } },
  linkedPerson: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  },
  convertedPolicy: { select: { id: true, policyNumber: true, status: true } },
  activities: {
    select: {
      id: true,
      type: true,
      occurredAt: true,
      outcome: true,
      note: true,
      nextActionAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { occurredAt: "desc" },
  },
  assignmentHistory: {
    select: {
      id: true,
      previousAgentId: true,
      newAgentId: true,
      mechanism: true,
      assignedAt: true,
      reason: true,
      previousAgent: { select: { id: true, name: true } },
      newAgent: { select: { id: true, name: true } },
      assignedBy: { select: { id: true, name: true } },
    },
    orderBy: { assignedAt: "desc" },
  },
  tasks: {
    select: { id: true, title: true, status: true, dueAt: true, assignedTo: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.LeadSelect;

// ---------------------------------------------------------------------------
// Detección de coincidencias por teléfono — compara contra el
// teléfono ACTUAL de cada Person, normalizado al vuelo en la consulta
// (nunca se modifica ni se hace backfill de Person.phone). No requiere
// columna ni índice nuevo en `people` — aceptable para el volumen de
// esta agencia; si creciera mucho, se podría agregar una columna
// generada/índice funcional más adelante (fuera de alcance de V1).
// ---------------------------------------------------------------------------
type PersonPhoneMatch = { id: string; firstName: string; lastName: string; assignedAgentId: string | null };

async function findPersonMatchesByPhone(phoneNormalized: string): Promise<PersonPhoneMatch[]> {
  if (!phoneNormalized) return [];
  return prisma.$queryRaw<PersonPhoneMatch[]>`
    SELECT id, "firstName", "lastName", "assignedAgentId"
    FROM people
    WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = ${phoneNormalized}
      AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') != ''
  `;
}

// Batch para listados (evita N+1: una sola consulta IN para toda la
// página, en vez de una por fila).
async function findPersonMatchCountsByPhones(phonesNormalized: string[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(phonesNormalized.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ normalized: string; match_count: bigint }[]>`
    SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') AS normalized, COUNT(*) AS match_count
    FROM people
    WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = ANY(${unique})
    GROUP BY normalized
  `;
  return new Map(rows.map((r) => [r.normalized, Number(r.match_count)]));
}

async function findRelatedLeadsByPhone(phoneNormalized: string, excludeLeadId: string) {
  if (!phoneNormalized) return [];
  return prisma.lead.findMany({
    where: { phoneNormalized, id: { not: excludeLeadId } },
    select: { id: true, fullName: true, receivedAt: true, stage: true, followUpStatus: true, linkedPersonId: true },
    orderBy: { receivedAt: "desc" },
  });
}

async function assertAssignableAgent(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, isAgent: true },
  });
  if (!user) throw new AppError("VALIDATION_ERROR", "assignedToId: El usuario seleccionado ya no existe.");
  if (!user.isActive) throw new AppError("VALIDATION_ERROR", "assignedToId: El usuario seleccionado está inactivo.");
  if (!user.isAgent) {
    throw new AppError(
      "VALIDATION_ERROR",
      "assignedToId: El usuario seleccionado no tiene la condición de agente (isAgent)."
    );
  }
  return user.id;
}

// ---------------------------------------------------------------------------
// Idempotencia con detección de datos distintos — un reenvío con la
// MISMA clave (externalId o idempotencyKey) y los MISMOS datos sigue
// devolviendo el registro original sin duplicar; reutilizar la MISMA
// clave con datos DISTINTOS es un error del remitente (nunca se
// asume silenciosamente "es el mismo lead, solo que cambió algo") —
// se rechaza con CONFLICT (409), mismo criterio para externalId y para
// idempotencyKey.
//
// La comparación NUNCA se hace contra los campos actuales del Lead
// (editables desde "Editar datos", Fase 026) — se hace contra
// `originalPayloadSnapshot`, una instantánea INMUTABLE tomada en el
// momento de la recepción original. Si un agente corrige nombre/
// teléfono/correo después, un reenvío del payload ORIGINAL con la
// misma clave debe seguir reconociéndose como el mismo reenvío, nunca
// como "datos distintos" solo porque el registro editable cambió.
// ---------------------------------------------------------------------------
const idempotencyCompareSelect = {
  id: true,
  externalId: true,
  idempotencyKey: true,
  originalPayloadSnapshot: true,
} satisfies Prisma.LeadSelect;

type IdempotencyCompareRow = Prisma.LeadGetPayload<{ select: typeof idempotencyCompareSelect }>;

// Comparación de JSON INDEPENDIENTE DEL ORDEN de las propiedades de
// cada objeto, en cualquier nivel de anidamiento — ordena las claves
// recursivamente antes de serializar. El orden de los ARRAYS se
// conserva tal cual (un array no es un "conjunto de propiedades", dos
// arrays con los mismos elementos en distinto orden SÍ son datos
// distintos).
function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => [key, canonicalizeJsonValue(v)] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

function sameCanonicalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalizeJsonValue(a ?? null)) === JSON.stringify(canonicalizeJsonValue(b ?? null));
}

// Forma comparable y serializable del payload de recepción — se
// guarda tal cual en `originalPayloadSnapshot` al crear el lead, y se
// reconstruye de la misma forma a partir de cada reenvío para
// comparar. El teléfono se guarda NORMALIZADO (no el string crudo):
// dos formatos equivalentes del mismo número nunca deben verse como
// "datos distintos".
type IntakeSnapshot = {
  fullName: string;
  phoneNormalized: string;
  email: string | null;
  residenceState: string | null;
  productInterest: string | null;
  campaignId: string | null;
  campaignName: string | null;
  consentGiven: boolean | null;
  consentText: string | null;
  consentSource: string | null;
  consentDate: string | null;
  originalInquiryAt: string | null;
  formResponses: unknown;
};

function buildIntakeSnapshot(input: LeadIntakeInput): IntakeSnapshot {
  return {
    fullName: input.fullName,
    phoneNormalized: normalizeLeadPhone(input.phone),
    email: input.email ?? null,
    residenceState: input.residenceState ?? null,
    productInterest: input.productInterest ?? null,
    campaignId: input.campaignId ?? null,
    campaignName: input.campaignName ?? null,
    consentGiven: input.consentGiven ?? null,
    consentText: input.consentText ?? null,
    consentSource: input.consentSource ?? null,
    consentDate: input.consentDate ? input.consentDate.toISOString() : null,
    originalInquiryAt: input.originalInquiryAt ? input.originalInquiryAt.toISOString() : null,
    formResponses: input.formResponses ?? null,
  };
}

// Tratamiento de leads anteriores a este campo (o creados sin pasar
// por intakeLead): NUNCA se reconstruye un `originalPayloadSnapshot`
// a partir de sus campos actuales (eso sería inventar un payload que
// nunca se recibió). Sin instantánea no hay base verificable para
// comparar — se conserva el comportamiento previo a esta corrección
// (el reenvío se acepta como el mismo registro, sin comparar datos),
// documentado explícitamente en vez de fabricar una referencia falsa.
function assertSameIntakeDataOrThrow(
  existing: IdempotencyCompareRow,
  input: LeadIntakeInput,
  matchedVia: "externalId" | "idempotencyKey"
): void {
  if (existing.originalPayloadSnapshot === null) return;
  const incoming = buildIntakeSnapshot(input);
  if (sameCanonicalJson(existing.originalPayloadSnapshot, incoming)) return;
  const message =
    matchedVia === "externalId"
      ? "El externalId ya fue utilizado con otros datos. Usa un externalId nuevo para una nueva consulta."
      : "La clave de idempotencia ya fue utilizada con otros datos. Usa una clave nueva para una nueva consulta.";
  throw new AppError("CONFLICT", message);
}

// Busca por cada clave POR SEPARADO (nunca un solo OR) para poder
// detectar el caso en que externalId e idempotencyKey apuntan a DOS
// registros DISTINTOS — una inconsistencia del remitente, nunca se
// elige uno de los dos arbitrariamente ni se modifica ninguno.
async function resolveIdempotencyMatch(
  credentialId: string,
  input: LeadIntakeInput
): Promise<{ row: IdempotencyCompareRow; matchedVia: "externalId" | "idempotencyKey" } | null> {
  const [byExternalId, byIdempotencyKey] = await Promise.all([
    input.externalId
      ? prisma.lead.findFirst({
          where: { integrationCredentialId: credentialId, externalId: input.externalId },
          select: idempotencyCompareSelect,
        })
      : Promise.resolve(null),
    input.idempotencyKey
      ? prisma.lead.findFirst({
          where: { integrationCredentialId: credentialId, idempotencyKey: input.idempotencyKey },
          select: idempotencyCompareSelect,
        })
      : Promise.resolve(null),
  ]);

  if (byExternalId && byIdempotencyKey && byExternalId.id !== byIdempotencyKey.id) {
    throw new AppError(
      "CONFLICT",
      "El externalId y la clave de idempotencia corresponden a solicitudes distintas. Usa identificadores consistentes para la misma consulta."
    );
  }

  if (byExternalId) return { row: byExternalId, matchedVia: "externalId" };
  if (byIdempotencyKey) return { row: byIdempotencyKey, matchedVia: "idempotencyKey" };
  return null;
}

async function buildDuplicateResult(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: leadDetailSelect });
  if (!lead) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  return {
    lead,
    duplicate: true as const,
    personMatch: { matched: Boolean(lead.linkedPersonId), ambiguous: false, candidateCount: lead.linkedPersonId ? 1 : 0 },
    relatedLeads: await findRelatedLeadsByPhone(lead.phoneNormalized, lead.id),
  };
}

// ---------------------------------------------------------------------------
// Creación — compartida entre recepción por API (intakeLead) y
// creación manual (createLeadManual): mismo flujo de
// matching/task-pendiente/auditoría para ambos orígenes.
// ---------------------------------------------------------------------------
type LeadCreateData = {
  fullName: string;
  phone: string;
  email?: string;
  residenceState?: string;
  productInterest?: Prisma.LeadCreateInput["productInterest"];
  source: LeadSource;
  integrationCredentialId?: string;
  externalId?: string;
  idempotencyKey?: string;
  campaignId?: string;
  campaignName?: string;
  originalInquiryAt?: Date;
  consentGiven?: boolean | null;
  consentText?: string;
  consentDate?: Date;
  consentSource?: string;
  formResponses?: Prisma.InputJsonValue;
  // Solo lo pasa intakeLead — instantánea inmutable para comparar
  // futuros reenvíos (ver bloque de idempotencia arriba). Nunca se
  // toca después de crear el lead.
  originalPayloadSnapshot?: Prisma.InputJsonValue;
  assignedToId?: string | null;
  createdById?: string | null;
};

async function insertLeadRecord(data: LeadCreateData, actor: AuthorizedUser | null) {
  const phoneNormalized = normalizeLeadPhone(data.phone);
  if (!phoneNormalized) {
    throw new AppError("VALIDATION_ERROR", "phone: El teléfono no contiene dígitos válidos.");
  }

  const matches = await findPersonMatchesByPhone(phoneNormalized);
  // Solo se vincula automáticamente cuando hay EXACTAMENTE una
  // coincidencia — 0 o varias quedan pendientes de revisión por el
  // administrador (nunca se elige una arbitrariamente), ver §4.
  const linkedPersonId = matches.length === 1 ? matches[0].id : null;

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        phoneNormalized,
        email: data.email,
        residenceState: data.residenceState,
        productInterest: data.productInterest,
        source: data.source,
        integrationCredentialId: data.integrationCredentialId,
        externalId: data.externalId,
        idempotencyKey: data.idempotencyKey,
        campaignId: data.campaignId,
        campaignName: data.campaignName,
        originalInquiryAt: data.originalInquiryAt,
        consentGiven: data.consentGiven ?? null,
        consentText: data.consentText,
        consentDate: data.consentDate,
        consentSource: data.consentSource,
        formResponses: data.formResponses,
        originalPayloadSnapshot: data.originalPayloadSnapshot,
        linkedPersonId,
        assignedToId: data.assignedToId ?? null,
        createdById: data.createdById ?? null,
      },
      select: leadDetailSelect,
    });

    // §4.B: coincidencia de teléfono con una Person existente — tarea
    // de atención PENDIENTE de asignación (nunca auto-asignada, nunca
    // cambia Person.assignedAgentId). Solo se crea cuando SÍ se
    // encontró una persona — una coincidencia ambigua (varias
    // personas) queda señalada en el detalle del lead, sin tarea
    // automática, para que el administrador decida primero a cuál se
    // refiere.
    if (linkedPersonId) {
      await tx.task.create({
        data: {
          title: `Atender nueva consulta de ${data.fullName}`,
          description: "Consulta nueva de un teléfono que ya corresponde a un contacto existente.",
          priority: "NORMAL",
          leadId: created.id,
          personId: linkedPersonId,
          assignedToId: null,
        },
      });
    }

    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: created.id,
      action: "LEAD_CREATE",
      summary: `Lead recibido (${data.source}): ${data.fullName}`,
      metadata: {
        source: data.source,
        hasExternalId: Boolean(data.externalId),
        matchedExistingPerson: Boolean(linkedPersonId),
        ambiguousPersonMatch: matches.length > 1,
      },
    });

    return created;
  });

  return {
    lead,
    duplicate: false,
    personMatch: {
      matched: Boolean(linkedPersonId),
      ambiguous: matches.length > 1,
      candidateCount: matches.length,
    },
    relatedLeads: await findRelatedLeadsByPhone(phoneNormalized, lead.id),
  };
}

// ---------------------------------------------------------------------------
// Recepción autenticada por credencial — llamada desde la ruta API,
// nunca desde una sesión de usuario (actor = null => AuditEvent con
// actorType SYSTEM, ver audit.service.ts).
// ---------------------------------------------------------------------------
export async function intakeLead(
  credential: { id: string; source: LeadSource },
  rawPayload: unknown
) {
  const input = parseOrThrow(leadIntakeSchema, rawPayload);

  // §4.A/§4.3: reenvío de la MISMA solicitud por la MISMA integración
  // — se identifica por (integrationCredentialId, externalId) o
  // (integrationCredentialId, idempotencyKey), nunca por source a
  // secas. Ambas claves se resuelven POR SEPARADO (nunca un solo OR)
  // para poder detectar si apuntan a dos registros DISTINTOS, en cuyo
  // caso se rechaza sin modificar ninguno — ver resolveIdempotencyMatch.
  const match = await resolveIdempotencyMatch(credential.id, input);
  if (match) {
    assertSameIntakeDataOrThrow(match.row, input, match.matchedVia);
    return buildDuplicateResult(match.row.id);
  }

  const originalPayloadSnapshot = buildIntakeSnapshot(input) as unknown as Prisma.InputJsonValue;

  try {
    return await insertLeadRecord(
      {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        residenceState: input.residenceState,
        productInterest: input.productInterest,
        source: credential.source,
        integrationCredentialId: credential.id,
        externalId: input.externalId,
        idempotencyKey: input.idempotencyKey,
        campaignId: input.campaignId,
        campaignName: input.campaignName,
        originalInquiryAt: input.originalInquiryAt,
        consentGiven: input.consentGiven ?? null,
        consentText: input.consentText,
        consentDate: input.consentDate,
        consentSource: input.consentSource,
        formResponses: input.formResponses as Prisma.InputJsonValue | undefined,
        originalPayloadSnapshot,
      },
      null
    );
  } catch (error) {
    // §4.A: solicitudes simultáneas — ambas pasan el pre-check de
    // arriba (ninguna ve todavía la fila de la otra) y compiten en el
    // INSERT; el índice único de la base de datos deja pasar solo una,
    // la otra cae aquí con P2002 — se recupera la fila ganadora en vez
    // de propagar un error al remitente externo (un reenvío nunca debe
    // verse como una falla), aplicando la MISMA comparación contra su
    // instantánea antes de devolverla.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const winnerMatch = await resolveIdempotencyMatch(credential.id, input);
      if (winnerMatch) {
        assertSameIntakeDataOrThrow(winnerMatch.row, input, winnerMatch.matchedVia);
        return buildDuplicateResult(winnerMatch.row.id);
      }
    }
    throw error;
  }
}

export async function createLeadManual(actor: AuthorizedUser, rawInput: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(createLeadManualSchema, rawInput);

  const assignedToId = input.assignedToId ? await assertAssignableAgent(input.assignedToId) : null;

  const result = await insertLeadRecord(
    {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      residenceState: input.residenceState,
      productInterest: input.productInterest,
      source: "MANUAL",
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      consentGiven: input.consentGiven ?? null,
      consentText: input.consentText,
      assignedToId,
      createdById: actor.id,
    },
    actor
  );

  if (assignedToId) {
    await prisma.leadAssignmentHistory.create({
      data: {
        leadId: result.lead.id,
        previousAgentId: null,
        newAgentId: assignedToId,
        mechanism: "MANUAL",
        assignedById: actor.id,
        reason: "Asignación inicial al crear el lead.",
      },
    });
  }

  return result;
}

function buildLeadFilterWhere(filters: {
  search?: string;
  source?: string;
  campaignId?: string;
  stage?: string;
  followUpStatus?: string;
  receivedFrom?: string;
  receivedTo?: string;
}): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (filters.source) where.source = filters.source as LeadSource;
  if (filters.campaignId) where.campaignId = { contains: filters.campaignId, mode: "insensitive" };
  if (filters.stage) where.stage = filters.stage as Prisma.LeadWhereInput["stage"];
  if (filters.followUpStatus) where.followUpStatus = filters.followUpStatus as Prisma.LeadWhereInput["followUpStatus"];
  if (filters.receivedFrom || filters.receivedTo) {
    where.receivedAt = {
      ...(filters.receivedFrom ? { gte: new Date(`${filters.receivedFrom}T00:00:00.000Z`) } : {}),
      ...(filters.receivedTo ? { lte: new Date(`${filters.receivedTo}T23:59:59.999Z`) } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listLeads(actor: AuthorizedUser, rawQuery: unknown) {
  assertModuleAccess(actor);
  const { page, pageSize, search, source, campaignId, stage, followUpStatus, assignedToId, receivedFrom, receivedTo } =
    parseOrThrow(listLeadsQuerySchema, rawQuery);

  const where = buildLeadFilterWhere({ search, source, campaignId, stage, followUpStatus, receivedFrom, receivedTo });

  if (actor.role === "AGENT") {
    // Un AGENT nunca ve leads sin asignar ni de otro agente — se
    // ignora cualquier assignedToId solicitado, nunca se confía en el
    // valor enviado por el cliente.
    where.assignedToId = actor.id;
  } else if (assignedToId) {
    where.assignedToId = assignedToId === UNASSIGNED_LEAD_FILTER ? null : assignedToId;
  }

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: leadListSelect,
      orderBy: [{ receivedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.count({ where }),
  ]);

  // Indicador de "posible coincidencia" para los leads SIN persona
  // vinculada todavía — una sola consulta batched para toda la página.
  const unlinkedPhones = items.filter((l) => !l.linkedPersonId).map((l) => l.phoneNormalized);
  const matchCounts = await findPersonMatchCountsByPhones(unlinkedPhones);
  const itemsWithMatchHint = items.map((lead) => {
    if (lead.linkedPersonId) return { ...lead, personMatchHint: "LINKED" as const };
    const count = matchCounts.get(lead.phoneNormalized) ?? 0;
    return { ...lead, personMatchHint: count === 0 ? ("NONE" as const) : count === 1 ? ("SINGLE" as const) : ("AMBIGUOUS" as const) };
  });

  return { items: itemsWithMatchHint, total, page, pageSize };
}

export async function getLeadById(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  const id = parseOrThrow(leadIdSchema, rawId);

  const lead = await prisma.lead.findUnique({ where: { id }, select: leadDetailSelect });
  if (!lead) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, lead);

  const personMatches = lead.linkedPersonId ? [] : await findPersonMatchesByPhone(lead.phoneNormalized);
  const relatedLeads = await findRelatedLeadsByPhone(lead.phoneNormalized, lead.id);

  return { ...lead, personMatches, relatedLeads };
}

// Campos editables desde "Editar datos" (§ hallazgo UAT) — allowlist
// explícita para buildDiff, mismo patrón que PERSON_AUDIT_FIELDS/
// POLICY_AUDIT_FIELDS. Nunca incluye stage/followUpStatus/assignedToId
// (no se tocan al editar datos), ni source/integrationCredentialId/
// campaignId/campaignName/externalId/idempotencyKey (nunca editables
// desde este formulario), ni los campos de consentimiento (la
// evidencia original nunca se sobrescribe silenciosamente — ver
// docs/DECISIONS.md).
const LEAD_DETAIL_AUDIT_FIELDS = ["fullName", "phone", "email", "residenceState", "productInterest"] as const;

export async function updateLeadDetails(actor: AuthorizedUser, rawLeadId: unknown, rawInput: unknown) {
  const leadId = parseOrThrow(leadIdSchema, rawLeadId);
  const input = parseOrThrow(updateLeadDetailsSchema, rawInput);

  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      phoneNormalized: true,
      email: true,
      residenceState: true,
      productInterest: true,
      assignedToId: true,
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, existing);

  const phoneNormalized = normalizeLeadPhone(input.phone);
  if (!phoneNormalized) {
    throw new AppError("VALIDATION_ERROR", "phone: El teléfono no contiene dígitos válidos.");
  }
  const phoneChanged = phoneNormalized !== existing.phoneNormalized;

  const data = {
    fullName: input.fullName,
    phone: input.phone,
    phoneNormalized,
    email: input.email,
    residenceState: input.residenceState,
    productInterest: input.productInterest,
  };

  // Nunca toca linkedPersonId/convertedPolicyId/stage/followUpStatus —
  // un cambio de teléfono NUNCA vincula, desvincula ni fusiona
  // personas automáticamente; el historial de conversión (si el lead
  // ya fue convertido) queda intacto por construcción, sin necesidad
  // de una regla especial.
  const changes = buildDiff(existing, data, LEAD_DETAIL_AUDIT_FIELDS);

  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({ where: { id: leadId }, data, select: leadDetailSelect });
    if (changes) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "Lead",
        entityId: leadId,
        action: "LEAD_UPDATE_DETAILS",
        summary: `Datos del lead actualizados: ${lead.fullName}`,
        changes,
      });
    }
    return lead;
  });

  // Advertencia de coincidencia, NUNCA una acción automática — el
  // administrador/agente decide manualmente si corresponde vincular
  // (ver lead.linkedPersonId, que esta función nunca toca).
  const personMatches = phoneChanged ? await findPersonMatchesByPhone(phoneNormalized) : [];

  return { lead: updated, phoneChanged, personMatches };
}

export async function assignLead(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertAdmin(actor);
  const id = parseOrThrow(leadIdSchema, rawId);
  const input = parseOrThrow(assignLeadSchema, rawInput);

  const existing = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, fullName: true, assignedToId: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Lead no encontrado.");

  const newAgentId = input.assignedToId === "" ? null : await assertAssignableAgent(input.assignedToId);
  const previousAgentId = existing.assignedToId;

  if (previousAgentId === newAgentId) {
    return prisma.lead.findUnique({ where: { id }, select: leadDetailSelect });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({ where: { id }, data: { assignedToId: newAgentId }, select: leadDetailSelect });

    await tx.leadAssignmentHistory.create({
      data: {
        leadId: id,
        previousAgentId,
        newAgentId,
        mechanism: "MANUAL",
        assignedById: actor.id,
        reason: input.reason,
      },
    });

    // Reasigna la tarea de atención PENDIENTE del lead (si existe y
    // sigue abierta) al mismo agente — nunca toca tareas ya
    // completadas/canceladas (ver docs/DECISIONS.md, mismo criterio
    // que el resto del módulo de Tareas).
    if (input.reassignPendingTask) {
      await tx.task.updateMany({
        where: { leadId: id, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { assignedToId: newAgentId },
      });
    }

    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: id,
      action: "LEAD_ASSIGN",
      summary: `Lead reasignado: ${existing.fullName}`,
      changes: {
        assignedToId: { before: previousAgentId, after: newAgentId },
      },
    });

    return updated;
  });
}

export async function updateLeadFollowUpStatus(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(leadIdSchema, rawId);
  const input = parseOrThrow(updateLeadFollowUpStatusSchema, rawInput);

  const existing = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, fullName: true, assignedToId: true, followUpStatus: true, stage: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, existing);

  if (existing.followUpStatus === "CONVERTED" || existing.followUpStatus === "CLOSED") {
    throw new AppError("CONFLICT", "Este lead ya está en un estado final (convertido o cerrado).");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { followUpStatus: input.followUpStatus },
      select: leadDetailSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: id,
      action: "LEAD_FOLLOW_UP_STATUS_CHANGE",
      summary: `Estado de seguimiento actualizado: ${existing.fullName}`,
      changes: { followUpStatus: { before: existing.followUpStatus, after: input.followUpStatus } },
    });
    return updated;
  });
}

export async function markLeadAsProspect(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(leadIdSchema, rawId);
  const existing = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, fullName: true, assignedToId: true, stage: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, existing);

  if (existing.stage !== "LEAD") {
    throw new AppError("CONFLICT", "Solo un lead en etapa Lead puede pasar a Prospecto.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({ where: { id }, data: { stage: "PROSPECT" }, select: leadDetailSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: id,
      action: "LEAD_STAGE_CHANGE",
      summary: `Lead confirmado como Prospecto: ${existing.fullName}`,
      changes: { stage: { before: "LEAD", after: "PROSPECT" } },
    });
    return updated;
  });
}

export async function closeLead(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(leadIdSchema, rawId);
  const input = parseOrThrow(closeLeadSchema, rawInput);

  const existing = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, fullName: true, assignedToId: true, followUpStatus: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, existing);

  if (existing.followUpStatus === "CONVERTED") {
    throw new AppError("CONFLICT", "No puedes cerrar un lead ya convertido.");
  }
  if (existing.followUpStatus === "CLOSED") {
    throw new AppError("CONFLICT", "Este lead ya está cerrado.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { followUpStatus: "CLOSED", closeReason: input.closeReason, closeReasonDetail: input.closeReasonDetail },
      select: leadDetailSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: id,
      action: "LEAD_CLOSE",
      summary: `Lead cerrado: ${existing.fullName} (${input.closeReason})`,
      changes: { followUpStatus: { before: existing.followUpStatus, after: "CLOSED" } },
    });
    return updated;
  });
}

export async function addLeadActivity(actor: AuthorizedUser, rawLeadId: unknown, rawInput: unknown) {
  const leadId = parseOrThrow(leadIdSchema, rawLeadId);
  const input = parseOrThrow(createLeadActivitySchema, rawInput);

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, fullName: true, assignedToId: true },
  });
  if (!lead) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, lead);

  // Mismo formato "YYYY-MM-DDTHH:mm" que Task.dueAt — conversión a
  // instante UTC real interpretando los componentes como hora de
  // pared en APP_TIME_ZONE (ver tasks.service.ts::resolveDueAt).
  let nextActionAtUtc: Date | undefined;
  if (input.nextActionAt) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.nextActionAt);
    if (match) {
      const [year, month, day, hour, minute] = match.slice(1).map(Number);
      nextActionAtUtc = zonedTimeToUtc(year, month, day, hour, minute, 0, getAppTimeZone());
    }
  }

  return prisma.$transaction(async (tx) => {
    const activity = await tx.leadActivity.create({
      data: {
        leadId,
        type: input.type,
        authorUserId: actor.id,
        outcome: input.outcome,
        note: input.note,
        nextActionAt: nextActionAtUtc,
      },
      select: { id: true, type: true, occurredAt: true, outcome: true, note: true, nextActionAt: true },
    });

    // Integración aditiva con Tareas (§5): una próxima acción con
    // fecha crea una tarea nueva, nunca reemplaza/reutiliza una tarea
    // histórica existente.
    if (nextActionAtUtc) {
      await tx.task.create({
        data: {
          title: `Próxima acción — ${lead.fullName}`,
          leadId,
          assignedToId: lead.assignedToId,
          createdById: actor.id,
          dueAt: nextActionAtUtc,
        },
      });
    }

    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: leadId,
      action: "LEAD_ACTIVITY_CREATE",
      summary: `Actividad registrada (${input.type}): ${lead.fullName}`,
    });

    return activity;
  });
}

// ---------------------------------------------------------------------------
// Conversión — ATÓMICA (crear/vincular Person + crear Policy PENDING +
// actualizar Lead son UNA sola transacción real de PostgreSQL, no tres
// pasos encadenados). Si createPolicy falla DESPUÉS de crear una
// Person nueva, la transacción completa se revierte — la Person
// NUNCA queda huérfana, sin necesidad de un borrado compensatorio
// (que podría destruir datos o relaciones creadas concurrentemente por
// otra operación). Ver docs/DECISIONS.md.
//
// Concurrencia: `tx.lead.updateMany({ where: { id, convertedPolicyId:
// null }, ... })` "reclama" la conversión ANTES de crear nada. Un
// UPDATE siempre toma un lock de fila en PostgreSQL — una segunda
// conversión simultánea sobre el MISMO lead queda bloqueada hasta que
// la primera transacción termine; si la primera confirma, la segunda
// vuelve a evaluar el WHERE contra el estado ya confirmado, no
// encuentra la fila (ya no cumple `convertedPolicyId: null`) y se
// rechaza con CONFLICT — nunca crea una segunda Policy ni una segunda
// Person para el mismo lead. Si la primera falla y revierte, la
// "reclama" también se revierte, dejando el lead disponible para un
// reintento legítimo.
export async function convertLead(actor: AuthorizedUser, rawLeadId: unknown, rawInput: unknown) {
  const leadId = parseOrThrow(leadIdSchema, rawLeadId);
  const input = parseOrThrow(convertLeadSchema, rawInput);

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, fullName: true, assignedToId: true, followUpStatus: true, convertedPolicyId: true },
  });
  if (!lead) throw new AppError("NOT_FOUND", "Lead no encontrado.");
  assertCanAccessLead(actor, lead);

  // Fast-fail sin abrir transacción cuando el estado ya es
  // evidentemente terminal — la comprobación REAL que previene la
  // doble conversión bajo concurrencia es el updateMany de abajo, esto
  // es solo para devolver el error sin el costo de una transacción.
  if (lead.convertedPolicyId || lead.followUpStatus === "CONVERTED") {
    throw new AppError("CONFLICT", "Este lead ya fue convertido.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.lead.updateMany({
      where: { id: leadId, convertedPolicyId: null },
      data: { followUpStatus: "CONVERTED" },
    });
    if (claimed.count === 0) {
      throw new AppError("CONFLICT", "Este lead ya fue convertido.");
    }

    // Reutiliza EXACTAMENTE los servicios/validaciones existentes de
    // Contactos y Pólizas (§6), participando en ESTA MISMA transacción
    // (`tx`) — createPerson/createPolicy aplican sus propias reglas de
    // autorización (canEditPerson) sin cambios; si la persona elegida
    // no es accesible para este actor, createPolicy lanza FORBIDDEN
    // igual que en el flujo normal, revirtiendo también la "reclama"
    // de arriba.
    let personId: string;
    if (input.personId) {
      const person = await tx.person.findUnique({ where: { id: input.personId }, select: { id: true } });
      if (!person) throw new AppError("NOT_FOUND", "Contacto no encontrado.");
      personId = person.id;
    } else {
      const newPerson = await createPerson(actor, input.newPerson, tx);
      personId = newPerson.id;
    }

    const policy = await createPolicy(actor, { ...input.policy, holderId: personId, status: "PENDING" }, tx);

    await tx.lead.update({
      where: { id: leadId },
      data: { linkedPersonId: personId, convertedPolicyId: policy.id, stage: "CLIENT" },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Lead",
      entityId: leadId,
      action: "LEAD_CONVERT",
      contactPersonId: personId,
      policyId: policy.id,
      summary: `Lead convertido en cliente: ${lead.fullName}`,
      changes: {
        stage: { before: "LEAD", after: "CLIENT" },
        followUpStatus: { before: lead.followUpStatus, after: "CONVERTED" },
      },
    });

    return { policyId: policy.id };
  });

  // La transacción ya confirmó — ahora sí es seguro volver a consultar
  // el detalle completo vía las conexiones normales (createPolicy/
  // getLeadById con `tx` habrían visto datos todavía no confirmados).
  const updatedLead = await prisma.lead.findUnique({ where: { id: leadId }, select: leadDetailSelect });
  if (!updatedLead) throw new AppError("NOT_FOUND", "Lead no encontrado tras la conversión.");
  const policy = await getPolicyById(actor, result.policyId);
  return { lead: updatedLead, policy };
}

// ---------------------------------------------------------------------------
// Contadores para el Dashboard del administrador (§8) — "Sin asignar"
// es una condición INDEPENDIENTE (puede coincidir con cualquier
// estado), nunca se suma como un estado más del total. Los contadores
// usan followUpStatus (estado de seguimiento), nunca stage (etapa
// comercial) — ver alcance §8.
// ---------------------------------------------------------------------------
export async function getLeadCounts(actor: AuthorizedUser) {
  assertModuleAccess(actor);

  const baseWhere: Prisma.LeadWhereInput = actor.role === "AGENT" ? { assignedToId: actor.id } : {};

  const [grouped, unassigned] = await Promise.all([
    prisma.lead.groupBy({ by: ["followUpStatus"], where: baseWhere, _count: { _all: true } }),
    // "Sin asignar" solo tiene sentido para ADMIN — un AGENT nunca ve
    // leads sin asignar (ver listLeads), así que este conteo sería
    // siempre 0 para él; se calcula igual por simplicidad del DTO.
    prisma.lead.count({ where: { ...baseWhere, assignedToId: null } }),
  ]);

  const countsByStatus: Record<string, number> = {
    NEW: 0,
    IN_FOLLOW_UP: 0,
    CONTACTED: 0,
    QUOTE_SENT: 0,
    AWAITING_DECISION: 0,
    CONVERTED: 0,
    CLOSED: 0,
  };
  for (const row of grouped) {
    countsByStatus[row.followUpStatus] = row._count._all;
  }

  return {
    new: countsByStatus.NEW,
    inFollowUp: countsByStatus.IN_FOLLOW_UP,
    contacted: countsByStatus.CONTACTED,
    quoteSent: countsByStatus.QUOTE_SENT,
    awaitingDecision: countsByStatus.AWAITING_DECISION,
    converted: countsByStatus.CONVERTED,
    closed: countsByStatus.CLOSED,
    unassigned,
  };
}
