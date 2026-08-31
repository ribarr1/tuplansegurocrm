import { z } from "zod";
import { optionalSearchFilter, optionalUuidFilter } from "@/schemas/common";

// Valores reales de los enums de Task (prisma/schema.prisma), duplicados
// aquí como literales por la misma razón que en el resto de schemas.
export const TASK_STATUS_VALUES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const TASK_PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

// Estados desde los que "reabrir" (volver a OPEN/IN_PROGRESS) requiere
// una regla especial — ver assertCanReopen en tasks.service.ts.
export const TASK_CLOSED_STATUSES = ["COMPLETED", "CANCELLED"] as const;

export const taskIdSchema = z.uuid("Identificador de tarea inválido.");

export const listTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  assignedToId: optionalUuidFilter(),
  personId: optionalUuidFilter(),
  policyId: optionalUuidFilter(),
  // Vistas rápidas: "hoy" = dueAt cae en el día local de hoy y el
  // status sigue activo; "vencidas" = dueAt ya pasó y el status sigue
  // activo. Ninguna se guarda como status — ambas son filtros
  // derivados (ver docs/DECISIONS.md).
  dueToday: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  overdueOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

const titleSchema = z.string().trim().min(1, "El título es requerido.").max(200);

// datetime-local del navegador ("2026-08-31T14:30", sin offset) — el
// constructor de Date de JS interpreta ese formato como hora LOCAL del
// proceso que lo evalúa (a diferencia de una fecha sin "T", que se
// interpreta como UTC). Como el servidor corre en una sola zona
// horaria para esta V1 (ver docs/DECISIONS.md), z.coerce.date() ya
// hace la conversión correcta sin lógica adicional.
const dueAtCreateSchema = z.coerce.date().optional();

function nullableDueAt() {
  return z
    .string()
    .transform((v, ctx) => {
      const trimmed = v.trim();
      if (trimmed === "") return null;
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: "custom", message: "Fecha inválida." });
        return z.NEVER;
      }
      return date;
    })
    .optional();
}

function nullableDescription() {
  return z
    .string()
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), z.string().max(2000, "La descripción es demasiado larga.")]))
    .optional();
}

function nullableAssignedTo() {
  return z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), z.uuid("Selecciona un responsable válido.")]))
    .optional();
}

export const createTaskSchema = z.object({
  title: titleSchema,
  description: z.string().trim().min(1).max(2000).optional(),
  status: z.enum(TASK_STATUS_VALUES).default("OPEN"),
  priority: z.enum(TASK_PRIORITY_VALUES).default("NORMAL"),
  dueAt: dueAtCreateSchema,
  personId: z.uuid("Selecciona un contacto válido.").optional(),
  policyId: z.uuid("Selecciona una póliza válida.").optional(),
  assignedToId: z.uuid("Selecciona un responsable válido.").optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// personId/policyId no son editables tras crear la tarea — cambiar a
// qué contacto o póliza pertenece una tarea ya creada reabre las mismas
// preguntas de autorización que crearla de nuevo; más simple y honesto
// crear una tarea nueva si el vínculo cambió de verdad.
export const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  description: nullableDescription(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  dueAt: nullableDueAt(),
  assignedToId: nullableAssignedTo(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
