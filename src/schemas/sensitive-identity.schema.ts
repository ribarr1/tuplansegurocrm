import { z } from "zod";
import { isValidSsn, normalizeIdentifier } from "@/lib/sensitive-identity-format";

// Identidad sensible del contacto (SSN, información migratoria) —
// Fase 021. Los valores en claro (SSN/USCIS/número de documento)
// NUNCA se persisten — el servicio los cifra antes de guardar (ver
// src/services/sensitive-identity.service.ts, src/lib/pii-crypto.ts).
// Estos schemas solo validan el INPUT del usuario, nunca tocan el
// valor cifrado ya almacenado.

export const personIdParamSchema = z.uuid("Identificador de contacto inválido.");
export const immigrationDocumentIdSchema = z.uuid("Identificador de documento inválido.");

// Valores reales de ImmigrationCategory (prisma/schema.prisma).
export const IMMIGRATION_CATEGORY_VALUES = [
  "US_CITIZEN",
  "LAWFUL_PERMANENT_RESIDENT",
  "EMPLOYMENT_AUTHORIZATION",
  "OTHER",
  "UNKNOWN",
] as const;

// Valores reales de ImmigrationDocumentType (prisma/schema.prisma).
export const IMMIGRATION_DOCUMENT_TYPE_VALUES = [
  "PERMANENT_RESIDENT_CARD",
  "EMPLOYMENT_AUTHORIZATION_DOCUMENT",
  "OTHER",
] as const;

export const updateImmigrationCategorySchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  immigrationCategory: z.enum(IMMIGRATION_CATEGORY_VALUES, "Selecciona una categoría válida."),
});
export type UpdateImmigrationCategoryInput = z.infer<typeof updateImmigrationCategorySchema>;

// Acepta "123-45-6789" o "123456789" — normalizado a 9 dígitos por el
// propio schema, así el servicio nunca recibe un formato ambiguo.
export const setSsnSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  ssn: z
    .string()
    .trim()
    .refine((v) => isValidSsn(v), "El SSN debe tener 9 dígitos (ej. 123-45-6789)."),
});
export type SetSsnInput = z.infer<typeof setSsnSchema>;

export const personIdOnlySchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
});
export type PersonIdOnlyInput = z.infer<typeof personIdOnlySchema>;

// USCIS/A-Number: formato menos estandarizado que un SSN, validación
// deliberadamente laxa (no vacío, longitud razonable) — ver
// sensitive-identity-format.ts.
export const setUscisNumberSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  uscisNumber: z
    .string()
    .trim()
    .min(1, "El USCIS/A-Number es obligatorio.")
    .max(50, "El USCIS/A-Number es demasiado largo.")
    .refine((v) => normalizeIdentifier(v) !== null, "El USCIS/A-Number es obligatorio."),
});
export type SetUscisNumberInput = z.infer<typeof setUscisNumberSchema>;

function optionalDateOnly() {
  return z.coerce.date().optional();
}

export const createImmigrationDocumentSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  documentType: z.enum(IMMIGRATION_DOCUMENT_TYPE_VALUES, "Selecciona un tipo de documento válido."),
  documentNumber: z
    .string()
    .trim()
    .max(50, "El número de documento es demasiado largo.")
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  issuedDate: optionalDateOnly(),
  expirationDate: optionalDateOnly(),
});
export type CreateImmigrationDocumentInput = z.infer<typeof createImmigrationDocumentSchema>;

// documentNumber presente y no vacío => reemplaza el número cifrado;
// ausente => no lo toca (mismo patrón "ausente vs. vacío" ya
// establecido en el resto del proyecto). issuedDate/expirationDate
// usan z.union para poder limpiarse explícitamente a null (fecha ya
// desconocida) sin confundirse con "no enviado".
export const updateImmigrationDocumentSchema = z.object({
  documentType: z.enum(IMMIGRATION_DOCUMENT_TYPE_VALUES, "Selecciona un tipo de documento válido.").optional(),
  documentNumber: z
    .string()
    .trim()
    .max(50, "El número de documento es demasiado largo.")
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  issuedDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  expirationDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
});
export type UpdateImmigrationDocumentInput = z.infer<typeof updateImmigrationDocumentSchema>;
