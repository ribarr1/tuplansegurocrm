import { z } from "zod";
import { optionalSearchFilter, optionalUuidFilter, optionalEnumFilter, optionalBooleanFilter } from "@/schemas/common";

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
  status: optionalEnumFilter(TASK_STATUS_VALUES),
  priority: optionalEnumFilter(TASK_PRIORITY_VALUES),
  assignedToId: optionalUuidFilter(),
  personId: optionalUuidFilter(),
  policyId: optionalUuidFilter(),
  // Vistas rápidas: "hoy" = dueAt cae en el día local de hoy y el
  // status sigue activo; "vencidas" = dueAt ya pasó y el status sigue
  // activo. Ninguna se guarda como status — ambas son filtros
  // derivados (ver docs/DECISIONS.md).
  dueToday: optionalBooleanFilter(),
  overdueOnly: optionalBooleanFilter(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

const titleSchema = z.string().trim().min(1, "El título es requerido.").max(200);

// "YYYY-MM-DDTHH:mm" (24h, SIN offset de zona horaria) — mismo formato
// que ya producía <input type="datetime-local">, ahora producido por
// USDateTimeInput (Fase 020, §5). Este schema solo valida el FORMATO y
// que sea una fecha/hora de calendario real — la conversión a un
// instante UTC real se hace en tasks.service.ts vía zonedTimeToUtc
// (business-time.ts), interpretando el string explícitamente como hora
// de pared en APP_TIME_ZONE. Nunca se hace aquí: business-time.ts
// depende de "server-only" y este schema se importa también desde
// componentes cliente (para TASK_STATUS_VALUES/TASK_PRIORITY_VALUES),
// así que no puede arrastrar esa dependencia.
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isValidLocalDateTime(value: string): boolean {
  const match = LOCAL_DATETIME_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  return true;
}

const dueAtCreateSchema = z
  .string()
  .refine((v) => v.trim() === "" || isValidLocalDateTime(v.trim()), "Fecha/hora inválida.")
  .transform((v) => (v.trim() === "" ? undefined : v.trim()))
  .optional();

// CORRECCIÓN (vencimiento de tareas): el <input type="hidden"> que
// combina fecha/hora/AM-PM (USDateTimeInput) SIEMPRE está presente en
// el formulario de edición, así que el servidor nunca puede distinguir
// "el campo llegó vacío porque el usuario no lo tocó" de "" a secas —
// antes esta función transformaba "" en `null`, y tasks.service.ts
// interpretaba `null` como "borrar el vencimiento", así que CUALQUIER
// guardado con el campo vacío (p. ej. una tarea sin vencimiento, o el
// campo todavía sin inicializar) borraba silenciosamente el
// vencimiento existente. Ahora "" se traduce a `undefined` (no tocar,
// mismo criterio que el resto de campos opcionales de este schema) —
// borrar el vencimiento es SOLO posible mediante el campo explícito
// `clearDueAt` (ver updateTaskSchema y tasks.service.ts::updateTask).
function optionalDueAtUpdate() {
  return z
    .string()
    .transform((v, ctx) => {
      const trimmed = v.trim();
      if (trimmed === "") return undefined;
      if (!isValidLocalDateTime(trimmed)) {
        ctx.addIssue({ code: "custom", message: "Fecha/hora inválida." });
        return z.NEVER;
      }
      return trimmed;
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
  dueAt: optionalDueAtUpdate(),
  // CORRECCIÓN (vencimiento de tareas): única vía para borrar un
  // vencimiento existente — nunca se infiere de un campo dueAt vacío
  // (ver optionalDueAtUpdate arriba). Checkbox explícito en el
  // formulario, nunca marcado por defecto.
  clearDueAt: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  assignedToId: nullableAssignedTo(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
