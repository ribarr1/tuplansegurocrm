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
  source: true,
  updatedAt: true,
  _count: {
    select: { holderPolicies: true, tasks: true, notes: true },
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

async function resolveAssignedAgentIdForCreate(
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

  const [items, total] = await prisma.$transaction([
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

  const person = await prisma.person.create({
    data: { ...input, assignedAgentId },
    select: detailSelect,
  });
  return person;
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
    select: { id: true, assignedAgentId: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  assertCanEdit(actor, existing);

  const { assignedAgentId: requestedAssignedAgentId, ...rest } = input;
  const data: Prisma.PersonUncheckedUpdateInput = { ...rest };

  if (requestedAssignedAgentId !== undefined) {
    if (actor.role !== "ADMIN") {
      throw new AppError("FORBIDDEN", "Solo ADMIN puede reasignar el agente.");
    }
    data.assignedAgentId = await assertActiveAgent(requestedAssignedAgentId);
  }

  const updated = await prisma.person.update({ where: { id }, data, select: detailSelect });
  return updated;
}
