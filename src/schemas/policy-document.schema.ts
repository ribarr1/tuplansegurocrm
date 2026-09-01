import { z } from "zod";

export const POLICY_DOCUMENT_TYPE_VALUES = [
  "PLAN_SUMMARY",
  "BROCHURE",
  "FORMULARY",
  "PROVIDER_DIRECTORY",
  "MEMBER_CARD",
  "APPLICATION",
  "OTHER",
] as const;

// Allow-list, no block-list — cualquier extensión/mime fuera de esta
// lista se rechaza automáticamente, sin necesidad de enumerar
// .exe/.js/.html/.svg explícitamente (ver docs/DECISIONS.md).
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export const policyDocumentIdSchema = z.uuid("Identificador de documento inválido.");

export const uploadPolicyDocumentMetaSchema = z.object({
  policyId: z.uuid("Selecciona una póliza válida."),
  type: z.enum(POLICY_DOCUMENT_TYPE_VALUES, "Selecciona un tipo de documento válido."),
  description: z.string().trim().min(1).max(500).optional(),
});
export type UploadPolicyDocumentMetaInput = z.infer<typeof uploadPolicyDocumentMetaSchema>;
