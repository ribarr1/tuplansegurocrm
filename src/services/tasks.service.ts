import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import { canAccessPolicy } from "@/services/policies.service";
import { getTodayBusinessRange } from "@/lib/business-time";
import { personIdSchema } from "@/schemas/person.schema";
import {
  taskIdSchema,
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
  TASK_CLOSED_STATUSES,
} from "@/schemas/task.schema";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Política de acceso — Task (V1)
//
// Ver/crear/editar/completar/cancelar:
//   ADMIN, ASSISTANT: cualquier tarea.
//   AGENT: solo si es responsable (assignedToId === actor.id), O la
//          tarea está vinculada a un Person al que tiene acceso
//          (canEditPerson), O está vinculada a una Policy a la que
//          tiene acceso (canAccessPolicy). Una tarea general (sin
//          Person/Policy) que no le fue asignada queda fuera de su
//          acceso — es administrativa, no operativa de su cartera.
//
// Responsable (assignedToId):
//   AGENT siempre queda asignado a sí mismo al crear — cualquier valor
//   enviado se ignora (mismo patrón que assignedAgentId en Person,
//   Fase 008). AGENT nunca puede reasignar una tarea ya creada
//   (rechazo explícito FORBIDDEN, no solo ignorado).
//   ADMIN/ASSISTANT: pueden asignar a cualquier usuario activo, o
//   dejar sin asignar.
//
// Reabrir una tarea COMPLETED/CANCELLED hacia OPEN/IN_PROGRESS
// requiere ADMIN — completar/cancelar por error operativo se corrige
// con supervisión, no libremente por cualquiera con acceso.
// ---------------------------------------------------------------------------

const personSummarySelect = {
  id: true,
  firstName: true,
  lastName: true,
  assignedAgentId: true,
} satisfies Prisma.PersonSelect;

const policySummarySelect = {
  id: true,
  policyNumber: true,
  product: { select: { policyType: true, carrier: { select: { name: true } } } },
  holder: { select: personSummarySelect },
  members: { select: { person: { select: { assignedAgentId: true } } } },
} satisfies Prisma.PolicySelect;

const userSummarySelect = { id: true, name: true } satisfies Prisma.UserSelect;

// Sin HealthPolicyDetail, comisiones, PersonProvider ni PersonMedication
// — solo lo necesario para mostrar la tarea y decidir acceso.
const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  person: { select: personSummarySelect },
  policy: { select: policySummarySelect },
  assignedTo: { select: userSummarySelect },
  createdBy: { select: userSummarySelect },
} satisfies Prisma.TaskSelect;

type TaskWithAccessData = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

function isClosedStatus(status: string): status is (typeof TASK_CLOSED_STATUSES)[number] {
  return (TASK_CLOSED_STATUSES as readonly string[]).includes(status);
}

// Derivado, nunca almacenado — ver docs/DECISIONS.md. Comparar dos
// instantes (dueAt vs. ahora) no depende de ninguna zona horaria de
// negocio — a diferencia de "hoy", que si depende (ver
// getTodayBusinessRange más abajo).
export function isTaskOverdue(task: { status: TaskStatus; dueAt: Date | null }): boolean {
  return Boolean(task.dueAt) && task.dueAt! < new Date() && !isClosedStatus(task.status);
}

function canAccessTask(actor: AuthorizedUser, task: TaskWithAccessData): boolean {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return true;
  if (actor.role === "AGENT") {
    if (task.assignedTo?.id === actor.id) return true;
    if (task.person && canEditPerson(actor, task.person)) return true;
    if (task.policy && canAccessPolicy(actor, [task.policy.holder, ...task.policy.members.map((m) => m.person)])) {
      return true;
    }
    return false;
  }
  return false;
}

function assertCanAccessTask(actor: AuthorizedUser, task: TaskWithAccessData): void {
  if (!canAccessTask(actor, task)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta tarea.");
  }
}

function agentAccessWhere(actor: AuthorizedUser): Prisma.TaskWhereInput | null {
  if (actor.role !== "AGENT") return null;
  return {
    OR: [
      { assignedToId: actor.id },
      { person: { assignedAgentId: null } },
      { person: { assignedAgentId: actor.id } },
      { policy: { holder: { assignedAgentId: null } } },
      { policy: { holder: { assignedAgentId: actor.id } } },
      { policy: { members: { some: { person: { assignedAgentId: null } } } } },
      { policy: { members: { some: { person: { assignedAgentId: actor.id } } } } },
    ],
  };
}


async function assertActiveUser(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!user || !user.isActive) {
    throw new AppError("VALIDATION_ERROR", "assignedToId: Selecciona un usuario activo válido.");
  }
  return user.id;
}

async function resolveAssignedToIdForCreate(
  actor: AuthorizedUser,
  requested: string | undefined
): Promise<string | null> {
  if (actor.role === "AGENT") return actor.id;
  if (!requested) return null;
  return assertActiveUser(requested);
}

async function resolveAssignedToIdForUpdate(
  actor: AuthorizedUser,
  requested: string | null | undefined
): Promise<string | null | undefined> {
  if (requested === undefined) return undefined;
  if (actor.role === "AGENT") {
    throw new AppError("FORBIDDEN", "No puedes reasignar esta tarea.");
  }
  if (requested === null) return null;
  return assertActiveUser(requested);
}

export async function listTasks(actor: AuthorizedUser, rawQuery: unknown) {
  const { page, pageSize, search, status, priority, assignedToId, personId, policyId, dueToday, overdueOnly } =
    parseOrThrow(listTasksQuerySchema, rawQuery);

  const where: Prisma.TaskWhereInput = {
    ...(personId ? { personId } : {}),
    ...(policyId ? { policyId } : {}),
    ...(assignedToId ? { assignedToId } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
  };

  if (overdueOnly) {
    where.status = { in: ["OPEN", "IN_PROGRESS"] };
    where.dueAt = { lt: new Date() };
  } else if (dueToday) {
    const { start, end } = getTodayBusinessRange();
    where.status = { in: ["OPEN", "IN_PROGRESS"] };
    where.dueAt = { gte: start, lt: end };
  } else if (status) {
    where.status = status;
  }
  if (priority) where.priority = priority;

  const agentWhere = agentAccessWhere(actor);
  const finalWhere: Prisma.TaskWhereInput = agentWhere ? { AND: [where, agentWhere] } : where;

  // Promise.all, no prisma.$transaction([...]) — ver docs/DECISIONS.md
  // ("Advertencia de concurrencia pg", Fase 019.6).
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where: finalWhere,
      select: taskSelect,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.task.count({ where: finalWhere }),
  ]);

  return { items, total, page, pageSize };
}

export async function getTaskById(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(taskIdSchema, rawId);
  const task = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!task) throw new AppError("NOT_FOUND", "Tarea no encontrada.");
  assertCanAccessTask(actor, task);
  return task;
}

export async function getTasksForPerson(actor: AuthorizedUser, rawPersonId: unknown) {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  const where: Prisma.TaskWhereInput = { personId };
  const agentWhere = agentAccessWhere(actor);
  const finalWhere: Prisma.TaskWhereInput = agentWhere ? { AND: [where, agentWhere] } : where;

  return prisma.task.findMany({
    where: finalWhere,
    select: taskSelect,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}

export async function createTask(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createTaskSchema, rawInput);

  if (input.personId) {
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { id: true, assignedAgentId: true },
    });
    if (!person) throw new AppError("NOT_FOUND", "Contacto no encontrado.");
    if (!canEditPerson(actor, person)) {
      throw new AppError("FORBIDDEN", "No tienes acceso a este contacto.");
    }
  }

  if (input.policyId) {
    const policy = await prisma.policy.findUnique({
      where: { id: input.policyId },
      select: {
        id: true,
        holder: { select: { assignedAgentId: true } },
        members: { select: { person: { select: { assignedAgentId: true } } } },
      },
    });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
    if (!canAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)])) {
      throw new AppError("FORBIDDEN", "No tienes acceso a esta póliza.");
    }
  }

  const assignedToId = await resolveAssignedToIdForCreate(actor, input.assignedToId);

  const created = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt,
      personId: input.personId,
      policyId: input.policyId,
      assignedToId,
      createdById: actor.id,
    },
    select: taskSelect,
  });
  return created;
}

export async function updateTask(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(taskIdSchema, rawId);
  const input = parseOrThrow(updateTaskSchema, rawInput);

  const existing = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Tarea no encontrada.");
  assertCanAccessTask(actor, existing);

  if (input.status !== undefined) {
    const isReopening = isClosedStatus(existing.status) && !isClosedStatus(input.status);
    if (isReopening && actor.role !== "ADMIN") {
      throw new AppError(
        "FORBIDDEN",
        "Solo un administrador puede reabrir una tarea completada o cancelada."
      );
    }
  }

  const resolvedAssignedToId = await resolveAssignedToIdForUpdate(actor, input.assignedToId);

  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueAt !== undefined) data.dueAt = input.dueAt;
  if (resolvedAssignedToId !== undefined) data.assignedToId = resolvedAssignedToId;
  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  const updated = await prisma.task.update({ where: { id }, data, select: taskSelect });
  return updated;
}

export async function completeTask(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(taskIdSchema, rawId);
  const existing = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Tarea no encontrada.");
  assertCanAccessTask(actor, existing);

  return prisma.task.update({
    where: { id },
    data: { status: "COMPLETED", completedAt: new Date() },
    select: taskSelect,
  });
}

export async function cancelTask(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(taskIdSchema, rawId);
  const existing = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Tarea no encontrada.");
  assertCanAccessTask(actor, existing);

  return prisma.task.update({
    where: { id },
    data: { status: "CANCELLED", completedAt: null },
    select: taskSelect,
  });
}
