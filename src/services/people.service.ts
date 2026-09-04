import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  createPersonSchema,
  updatePersonSchema,
  listPeopleQuerySchema,
  personIdSchema,
} from "@/schemas/person.schema";
import type { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";

const PERSON_AUDIT_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "secondLastName",
  "preferredName",
  "dateOfBirth",
  "sex",
  "email",
  "phone",
  "contactStatus",
  "source",
  "assignedAgentId",
] as const;

// ---------------------------------------------------------------------------
// Política de acceso — Person (V1)
//
// Ver / listar:      ADMIN, AGENT, ASSISTANT — cualquier usuario activo.
// Crear:              ADMIN, AGENT, ASSISTANT — cualquier usuario activo.
// Editar:
//   ADMIN, ASSISTANT: cualquier Person.
//   AGENT:            solo personas sin agente asignado o asignadas a sí
//                      mismo (su propia cartera).
//
// assignedAgentId (crear/editar):
//   ADMIN:      puede asignar cualquier User con role=AGENT y isActive=true.
//               Si no envía assignedAgentId, queda sin asignar (null).
//   AGENT:      siempre se asigna a sí mismo. Cualquier assignedAgentId
//               enviado por el cliente se ignora — un AGENT nunca puede
//               asignar un contacto a otro agente.
//   ASSISTANT:  el contacto queda sin asignar (null). ASSISTANT no
//               decide asignaciones todavía (sin reglas de equipos en V1).
//   Cambiar assignedAgentId en un update ya existente: solo ADMIN.
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  secondLastName: true,
  preferredName: true,
  phone: true,
  email: true,
  contactStatus: true,
  assignedAgentId: true,
  createdAt: true,
  assignedAgent: { select: { id: true, name: true } },
} satisfies Prisma.PersonSelect;

// Detalle: igual que el listado, más campos propios y un resumen (_count)
// de relaciones para verificar el modelo sin cargarlas por completo.
// Deliberadamente NO incluye PersonProvider/PersonMedication (información
// médica — requiere autorización específica cuando se construya ese
// módulo) ni notas/tareas/pólizas completas (evita mega-query).
const detailSelect = {
  ...listSelect,
  dateOfBirth: true,
  sex: true,
  source: true,
  updatedAt: true,
  _count: {
    select: { holderPolicies: true, tasks: true, notes: true, householdMembers: true },
  },
} satisfies Prisma.PersonSelect;

function assertCanListOrView(actor: AuthorizedUser): void {
  // Cualquier usuario activo autenticado puede consultar. La llamada
  // existe igual (en vez de omitir el check) para dejar explícito que
  // esta operación sí pasa por la política de acceso, no que se olvidó.
  void actor;
}

function assertCanCreate(actor: AuthorizedUser): void {
  void actor;
}

// Exportada (no solo interna) para que la UI decida qué renderizar
// (mostrar formulario vs. mensaje "no autorizado") sin duplicar la
// regla — la única fuente de verdad sigue siendo assertCanEdit, que la
// usa para lo que realmente importa: bloquear la escritura en el
// servicio. canEditPerson es una conveniencia de presentación, nunca
// el límite de seguridad real.
export function canEditPerson(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): boolean {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return true;
  if (actor.role === "AGENT") {
    return person.assignedAgentId === null || person.assignedAgentId === actor.id;
  }
  return false;
}

function assertCanEdit(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): void {
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "Solo puedes editar contactos asignados a ti.");
  }
}

// Exportada para que households.service.ts la reutilice al crear una
// Person nueva directamente desde el flujo "agregar miembro" de un
// hogar — misma política de asignación, una sola fuente de verdad.
export async function resolveAssignedAgentIdForCreate(
  actor: AuthorizedUser,
  requested: string | undefined
): Promise<string | null> {
  if (actor.role === "AGENT") return actor.id;
  if (actor.role === "ASSISTANT") return null;

  // ADMIN
  if (!requested) return null;
  return assertActiveAgent(requested);
}

async function assertActiveAgent(userId: string): Promise<string> {
  const agent = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!agent || agent.role !== "AGENT" || !agent.isActive) {
    throw new AppError(
      "VALIDATION_ERROR",
      "assignedAgentId debe ser un usuario con rol AGENT activo."
    );
  }
  return agent.id;
}

export async function listPeople(actor: AuthorizedUser, rawQuery: unknown) {
  assertCanListOrView(actor);
  const { page, pageSize, search, contactStatus } = parseOrThrow(
    listPeopleQuerySchema,
    rawQuery
  );

  const where: Prisma.PersonWhereInput = {
    ...(contactStatus ? { contactStatus } : {}),
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

  // Promise.all de dos llamadas top-level independientes, no
  // prisma.$transaction([...]) — ver docs/DECISIONS.md ("Advertencia de
  // concurrencia pg", Fase 019.6): el array-form de $transaction fija
  // ambas queries a una sola conexión, y un findMany con varias
  // relaciones seleccionadas dispara sub-queries concurrentes de Prisma
  // sobre esa misma conexión (warning real de pg, no cosmético).
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

export async function getPersonById(actor: AuthorizedUser, rawId: unknown) {
  assertCanListOrView(actor);
  const id = parseOrThrow(personIdSchema, rawId);

  const person = await prisma.person.findUnique({ where: { id }, select: detailSelect });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

export async function createPerson(actor: AuthorizedUser, rawInput: unknown) {
  assertCanCreate(actor);
  const input = parseOrThrow(createPersonSchema, rawInput);

  const assignedAgentId = await resolveAssignedAgentIdForCreate(
    actor,
    input.assignedAgentId
  );

  return prisma.$transaction(async (tx) => {
    const person = await tx.person.create({
      // Hallazgo #2 de UAT (Fase 022): TODO contacto nuevo nace como
      // PROSPECT, sin excepción — nunca se crea directamente como
      // Cliente desde este flujo (el import legacy es un camino
      // completamente separado, src/import/apply.ts, que sí puede
      // fijar CLIENT por razones históricas). Volverse Cliente es
      // siempre una consecuencia automática de tener cobertura activa
      // (recomputePersonContactStatus), nunca una elección al crear.
      data: { ...input, contactStatus: "PROSPECT", assignedAgentId },
      select: detailSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Person",
      entityId: person.id,
      action: "CONTACT_CREATE",
      contactPersonId: person.id,
      summary: `Contacto creado: ${person.firstName} ${person.lastName}`,
    });
    return person;
  });
}

export async function updatePerson(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown
) {
  const id = parseOrThrow(personIdSchema, rawId);
  const input = parseOrThrow(updatePersonSchema, rawInput);

  const existing = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      secondLastName: true,
      preferredName: true,
      dateOfBirth: true,
      sex: true,
      email: true,
      phone: true,
      contactStatus: true,
      source: true,
      assignedAgentId: true,
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  assertCanEdit(actor, existing);

  const { assignedAgentId: requestedAssignedAgentId, ...rest } = input;
  const data: Prisma.PersonUncheckedUpdateInput = { ...rest };
  let resolvedAssignedAgentId: string | undefined;

  if (requestedAssignedAgentId !== undefined) {
    if (actor.role !== "ADMIN") {
      throw new AppError("FORBIDDEN", "Solo ADMIN puede reasignar el agente.");
    }
    resolvedAssignedAgentId = await assertActiveAgent(requestedAssignedAgentId);
    data.assignedAgentId = resolvedAssignedAgentId;
  }

  // El diff se calcula contra el mismo objeto `data` que realmente se
  // aplica (assignedAgentId ya resuelto), nunca contra el input crudo —
  // así el before/after siempre refleja el valor real guardado.
  const changes = buildDiff(
    existing,
    { ...rest, ...(resolvedAssignedAgentId !== undefined ? { assignedAgentId: resolvedAssignedAgentId } : {}) },
    PERSON_AUDIT_FIELDS
  );
  // ASSIGN_AGENT es el hecho más relevante de este cambio cuando ocurre
  // — incluso si además se tocaron otros campos en el mismo submit —
  // seguido de STATUS_CHANGE, y UPDATE genérico en cualquier otro caso.
  const action =
    resolvedAssignedAgentId !== undefined
      ? "CONTACT_ASSIGN_AGENT"
      : input.contactStatus !== undefined && input.contactStatus !== existing.contactStatus
        ? "CONTACT_STATUS_CHANGE"
        : "CONTACT_UPDATE";

  return prisma.$transaction(async (tx) => {
    const updated = await tx.person.update({ where: { id }, data, select: detailSelect });
    if (changes) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "Person",
        entityId: id,
        action,
        contactPersonId: id,
        summary: `Contacto actualizado: ${updated.firstName} ${updated.lastName}`,
        changes,
      });
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Ciclo automático Prospecto <-> Cliente — Fase 022 (Hallazgo #2 de UAT)
//
// Regla de negocio: la fuente de verdad de si alguien es Cliente es
// "¿esta Person está cubierta como PolicyMember de al menos una Policy
// ACTIVE?" — NUNCA "¿es titular?" ni "¿pertenece a un Household?". Se
// aplica por igual a titular, esposo/a, hijo/a, dependiente u otro
// miembro cubierto: todos son simplemente PolicyMember.
//
// Solo alterna entre PROSPECT y CLIENT. FORMER_CLIENT/OTHER son
// decisiones administrativas explícitas (alguien decidió a mano que ya
// no es cliente activo, o que no encaja en las otras categorías) —
// esta función NUNCA las sobrescribe, ni siquiera si la persona vuelve
// a tener cobertura activa; volver a marcarla como Cliente en ese caso
// requiere una acción manual explícita, igual que hoy.
//
// Idempotente: si el status ya es el correcto, no escribe ni audita
// nada. Se llama SIEMPRE dentro de la misma transacción que el cambio
// de membresía/estado de póliza que la dispara (nunca aparte, para que
// nunca quede un estado a medias si algo falla).
const AUTO_MANAGED_CONTACT_STATUSES = ["PROSPECT", "CLIENT"] as const;

export async function recomputePersonContactStatus(
  tx: Prisma.TransactionClient,
  personId: string,
  actor: AuthorizedUser | null
): Promise<void> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: { id: true, contactStatus: true },
  });
  if (!person) return;
  if (!(AUTO_MANAGED_CONTACT_STATUSES as readonly string[]).includes(person.contactStatus)) return;

  const activeCoverage = await tx.policyMember.findFirst({
    where: { personId, policy: { status: "ACTIVE" } },
    select: { id: true },
  });
  const nextStatus = activeCoverage ? "CLIENT" : "PROSPECT";
  if (nextStatus === person.contactStatus) return;

  await tx.person.update({ where: { id: personId }, data: { contactStatus: nextStatus } });
  await recordAuditEvent(tx, {
    actor,
    entityType: "Person",
    entityId: personId,
    action: "CONTACT_STATUS_CHANGE",
    contactPersonId: personId,
    summary:
      nextStatus === "CLIENT"
        ? "Contacto actualizado automáticamente a Cliente (cobertura activa)"
        : "Contacto actualizado automáticamente a Prospecto (sin cobertura activa)",
    changes: { contactStatus: { before: person.contactStatus, after: nextStatus } },
  });
}
