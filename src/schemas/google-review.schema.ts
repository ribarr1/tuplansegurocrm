import { z } from "zod";
import { personIdSchema, assignedAgentIdFilterSchema } from "@/schemas/person.schema";

// Fase 025.5 (UAT-10) — seguimiento administrativo de reseñas de
// Google. Nombres técnicos coherentes con el resto del proyecto
// (mismo patrón que ContactStatus/PolicyStatus); traducción a español
// vive en GOOGLE_REVIEW_STATUS_LABELS (src/lib/labels.ts), nunca aquí.
export const GOOGLE_REVIEW_STATUS_VALUES = [
  "PENDING_REQUEST",
  "REQUESTED",
  "PUBLISHED",
  "DO_NOT_REQUEST",
] as const;

export const setGoogleReviewStatusSchema = z.object({
  personId: personIdSchema,
  status: z.enum(GOOGLE_REVIEW_STATUS_VALUES, "Selecciona un estado válido."),
});
export type SetGoogleReviewStatusInput = z.infer<typeof setGoogleReviewStatusSchema>;

export const listReviewCandidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CONTACT_STATUS_VALUES = ["PROSPECT", "CLIENT", "FORMER_CLIENT", "OTHER"] as const;

export const listContactsWithReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  contactStatus: z.enum(CONTACT_STATUS_VALUES).optional(),
  reviewStatus: z.enum(GOOGLE_REVIEW_STATUS_VALUES).optional(),
  // Fase 025.5.1 (UAT-11): mismo filtro por Person.assignedAgentId que
  // /contacts sin vista de reseñas — debe combinarse con el filtro de
  // reseña, nunca ser mutuamente excluyente.
  assignedAgentId: assignedAgentIdFilterSchema,
});
