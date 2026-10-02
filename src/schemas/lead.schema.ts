import { z } from "zod";
import {
  optionalSearchFilter,
  optionalEnumFilter,
  emptyStringToUndefined,
} from "@/schemas/common";
import { US_STATE_CODES } from "@/lib/us-states";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";

// Valores reales de los enums de Lead (prisma/schema.prisma), duplicados
// aquí como literales — misma razón que el resto de schemas (Zod no
// puede importar un enum de Prisma en un módulo portable a cliente).
export const LEAD_SOURCE_VALUES = ["GOOGLE", "META", "WEB", "MANUAL", "OTHER"] as const;
export const LEAD_STAGE_VALUES = ["LEAD", "PROSPECT", "CLIENT"] as const;
export const LEAD_FOLLOW_UP_STATUS_VALUES = [
  "NEW",
  "IN_FOLLOW_UP",
  "CONTACTED",
  "QUOTE_SENT",
  "AWAITING_DECISION",
  "CONVERTED",
  "CLOSED",
] as const;
export const LEAD_CLOSE_REASON_VALUES = [
  "NOT_INTERESTED",
  "NO_RESPONSE",
  "INVALID_DATA",
  "NOT_ELIGIBLE",
  "DOES_NOT_WANT_CONTACT",
  "OTHER",
] as const;
export const LEAD_ACTIVITY_TYPE_VALUES = ["CALL", "WHATSAPP", "EMAIL", "NOTE"] as const;

// Filtro especial de /leads: "sin asignar" es una condición
// independiente de cualquier estado (ver dashboard.service.ts) — mismo
// patrón que UNASSIGNED_AGENT_FILTER de person.schema.ts.
export const UNASSIGNED_LEAD_FILTER = "unassigned" as const;

export const leadIdSchema = z.uuid("Identificador de consulta inválido.");

const leadPhoneSchema = z
  .string()
  .trim()
  .min(7, "El teléfono debe tener al menos 7 caracteres.")
  .max(20, "El teléfono es demasiado largo.");

const leadFullNameSchema = z.string().trim().min(1, "El nombre es requerido.").max(200);

// Límite de tamaño para formResponses — JSON validado y ACOTADO (nunca
// un blob arbitrario sin límite, per alcance #1 "Recepción"). 8 KB es
// suficiente para las respuestas de un formulario típico sin abrir la
// puerta a abuso de payload.
const MAX_FORM_RESPONSES_BYTES = 8192;
const formResponsesSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => Buffer.byteLength(JSON.stringify(v), "utf8") <= MAX_FORM_RESPONSES_BYTES, {
    message: `Las respuestas del formulario exceden el límite de ${MAX_FORM_RESPONSES_BYTES} bytes.`,
  })
  .optional();

// Fecha/hora ISO 8601 flexible (viene de un sistema externo, no de un
// <input> local) — solo se valida que sea una fecha real.
const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Fecha inválida.")
  .transform((v) => new Date(v));

// ---------------------------------------------------------------------------
// Recepción (API externa autenticada por credencial) — alcance #1.
//
// `source` NO forma parte de este schema: lo determina la credencial
// autenticada (lead-intake.service.ts), nunca el payload — un
// remitente externo no puede declararse una fuente distinta a la suya.
// Idempotencia: se requiere externalId O idempotencyKey (al menos
// uno) — ver Lead@@unique([integrationCredentialId, externalId]) y
// @@unique([integrationCredentialId, idempotencyKey]).
// `consentGiven` es nullable de tres estados — ausente/null significa
// "la fuente no informó", nunca se traduce a false.
// ---------------------------------------------------------------------------
export const leadIntakeSchema = z
  .object({
    fullName: leadFullNameSchema,
    phone: leadPhoneSchema,
    email: z.email("Correo electrónico inválido.").optional(),
    residenceState: z.enum(US_STATE_CODES, "Estado inválido.").optional(),
    productInterest: z.enum(POLICY_TYPE_VALUES, "Tipo de seguro inválido.").optional(),
    externalId: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    campaignId: z.string().trim().min(1).max(200).optional(),
    campaignName: z.string().trim().min(1).max(200).optional(),
    originalInquiryAt: isoDateTimeSchema.optional(),
    consentGiven: z.boolean().nullable().optional(),
    consentText: z.string().trim().min(1).max(2000).optional(),
    consentDate: isoDateTimeSchema.optional(),
    consentSource: z.string().trim().min(1).max(200).optional(),
    formResponses: formResponsesSchema,
  })
  .refine((data) => Boolean(data.externalId) || Boolean(data.idempotencyKey), {
    message: "Debes enviar externalId o idempotencyKey para permitir detectar reenvíos.",
    path: ["externalId"],
  });
export type LeadIntakeInput = z.infer<typeof leadIntakeSchema>;

// Creación manual (ADMIN) — misma forma, sin la exigencia de
// externalId/idempotencyKey (no hay reenvío posible de una creación a
// mano) y con assignedToId opcional desde el primer momento.
export const createLeadManualSchema = z.object({
  fullName: leadFullNameSchema,
  phone: leadPhoneSchema,
  email: z.email("Correo electrónico inválido.").optional(),
  residenceState: z.enum(US_STATE_CODES, "Estado inválido.").optional(),
  productInterest: z.enum(POLICY_TYPE_VALUES, "Tipo de seguro inválido.").optional(),
  campaignId: z.string().trim().min(1).max(200).optional(),
  campaignName: z.string().trim().min(1).max(200).optional(),
  // "" = no especificado (null, NUNCA se traduce a false) — mismo
  // criterio de tres estados que leadIntakeSchema, adaptado al
  // <select> del formulario de creación manual (ver leads/lead-form.tsx).
  consentGiven: z
    .enum(["", "true", "false"])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v === "true")),
  consentText: z.string().trim().min(1).max(2000).optional(),
  assignedToId: z.uuid("Selecciona un agente válido.").optional(),
});
export type CreateLeadManualInput = z.infer<typeof createLeadManualSchema>;

// Edición de datos (§ "Nuevo hallazgo UAT — edición de datos del
// lead"): reutiliza EXACTAMENTE las mismas validaciones de recepción
// (fullName/phone/email/residenceState/productInterest — mismos
// schemas que leadIntakeSchema/createLeadManualSchema). Nunca incluye
// fuente, integración, campaña original, externalId, idempotencyKey ni
// los campos de consentimiento (consentGiven/consentText/consentDate/
// consentSource) — esos NUNCA se editan ni se sobrescriben desde este
// formulario (ver leads.service.ts::updateLeadDetails). El formulario
// siempre reenvía TODOS los campos (no es un PATCH parcial) — "" es la
// señal explícita de "borrar" para los campos opcionales, nunca "no
// tocar".
export const updateLeadDetailsSchema = z.object({
  fullName: leadFullNameSchema,
  phone: leadPhoneSchema,
  email: z
    .union([z.literal(""), z.email("Correo electrónico inválido.")])
    .transform((v) => (v === "" ? null : v)),
  residenceState: z
    .union([z.literal(""), z.enum(US_STATE_CODES, "Estado inválido.")])
    .transform((v) => (v === "" ? null : v)),
  productInterest: z
    .union([z.literal(""), z.enum(POLICY_TYPE_VALUES, "Tipo de seguro inválido.")])
    .transform((v) => (v === "" ? null : v)),
});
export type UpdateLeadDetailsInput = z.infer<typeof updateLeadDetailsSchema>;

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  source: optionalEnumFilter(LEAD_SOURCE_VALUES),
  campaignId: optionalSearchFilter(200),
  stage: optionalEnumFilter(LEAD_STAGE_VALUES),
  followUpStatus: optionalEnumFilter(LEAD_FOLLOW_UP_STATUS_VALUES),
  assignedToId: z.preprocess(
    emptyStringToUndefined,
    z.union([z.literal(UNASSIGNED_LEAD_FILTER), z.uuid()]).optional()
  ),
  receivedFrom: z.preprocess(emptyStringToUndefined, z.iso.date().optional()),
  receivedTo: z.preprocess(emptyStringToUndefined, z.iso.date().optional()),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const assignLeadSchema = z.object({
  // Requerido (no .optional()): esta es una acción dedicada de
  // asignar/reasignar/desasignar, no una actualización parcial — ""
  // es la señal explícita de "dejar sin asignar".
  assignedToId: z.union([z.literal(""), z.uuid("Selecciona un agente válido.")]),
  reassignPendingTask: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

// CONVERTED y CLOSED se excluyen deliberadamente: son el resultado de
// convertLead/closeLead (acciones dedicadas, con sus propias reglas),
// nunca de este setter genérico — ver leads.service.ts.
export const MANUAL_FOLLOW_UP_STATUS_VALUES = [
  "NEW",
  "IN_FOLLOW_UP",
  "CONTACTED",
  "QUOTE_SENT",
  "AWAITING_DECISION",
] as const;

export const updateLeadFollowUpStatusSchema = z.object({
  followUpStatus: z.enum(MANUAL_FOLLOW_UP_STATUS_VALUES, "Selecciona un estado de seguimiento válido."),
});
export type UpdateLeadFollowUpStatusInput = z.infer<typeof updateLeadFollowUpStatusSchema>;

export const closeLeadSchema = z
  .object({
    closeReason: z.enum(LEAD_CLOSE_REASON_VALUES, "Selecciona un motivo de cierre."),
    closeReasonDetail: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((data) => data.closeReason !== "OTHER" || Boolean(data.closeReasonDetail), {
    message: "Describe el motivo cuando seleccionas Otro.",
    path: ["closeReasonDetail"],
  });
export type CloseLeadInput = z.infer<typeof closeLeadSchema>;

export const createLeadActivitySchema = z.object({
  type: z.enum(LEAD_ACTIVITY_TYPE_VALUES, "Selecciona un tipo de actividad."),
  outcome: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  // "YYYY-MM-DDTHH:mm" local, mismo formato que Task.dueAt — la
  // conversión a instante UTC real ocurre en leads.service.ts
  // (zonedTimeToUtc), nunca aquí (ver task.schema.ts para el porqué).
  nextActionAt: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Fecha/hora inválida.")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});
export type CreateLeadActivityInput = z.infer<typeof createLeadActivitySchema>;

// Conversión — reutiliza createPersonSchema/createPolicySchema
// (people.service.ts / policies.service.ts) por fuera de este schema;
// aquí solo se valida la FORMA de la elección: vincular una persona
// existente (personId) o crear una nueva (newPerson), nunca ambas.
export const convertLeadSchema = z
  .object({
    personId: z.uuid("Selecciona un contacto válido.").optional(),
    newPerson: z.record(z.string(), z.unknown()).optional(),
    policy: z.record(z.string(), z.unknown()),
  })
  .refine((data) => Boolean(data.personId) !== Boolean(data.newPerson), {
    message: "Selecciona un contacto existente o los datos de uno nuevo, no ambos.",
    path: ["personId"],
  });
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
