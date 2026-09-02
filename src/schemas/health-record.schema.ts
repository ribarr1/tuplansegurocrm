import { z } from "zod";

// Medicamentos y proveedores/médicos preferidos — Fase 019.8 (hallazgo
// #18 de UAT). Información operacional de salud (PersonMedication/
// PersonProvider ya existían en el schema desde la migración 005,
// pero sin UI/servicio hasta ahora) — ver docs/SECURITY.md sobre por
// qué es más sensible que el resto del CRM. V1 es enteramente manual;
// un catálogo de medicamentos/posologías queda explícitamente diferido
// (ver docs/DECISIONS.md).

export const personMedicationIdSchema = z.uuid("Identificador de medicamento inválido.");
export const personProviderIdSchema = z.uuid("Identificador de proveedor inválido.");

// Mismo patrón de "ausente -> no tocar; vacío -> null; con valor -> se
// valida" ya establecido en household.schema.ts (Fase 019.5/019.7),
// duplicado aquí en vez de exportado desde allá porque es un detalle
// de implementación de cada schema, no un concepto compartido.
function nullableTrimmedString(max: number, label: string) {
  return z
    .string()
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), z.string().max(max, `${label} es demasiado largo.`)]))
    .optional();
}

export const createPersonMedicationSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  name: z
    .string()
    .trim()
    .min(1, "El nombre del medicamento es obligatorio.")
    .max(200, "El nombre es demasiado largo."),
  dosage: nullableTrimmedString(100, "La dosis"),
  frequency: nullableTrimmedString(100, "La frecuencia"),
  notes: nullableTrimmedString(1000, "Las notas"),
});
export type CreatePersonMedicationInput = z.infer<typeof createPersonMedicationSchema>;

export const updatePersonMedicationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre del medicamento es obligatorio.")
    .max(200, "El nombre es demasiado largo.")
    .optional(),
  dosage: nullableTrimmedString(100, "La dosis"),
  frequency: nullableTrimmedString(100, "La frecuencia"),
  notes: nullableTrimmedString(1000, "Las notas"),
});
export type UpdatePersonMedicationInput = z.infer<typeof updatePersonMedicationSchema>;

// Valores reales de ProviderType (prisma/schema.prisma).
export const PROVIDER_TYPE_VALUES = ["PCP", "SPECIALIST", "OTHER"] as const;

export const createPersonProviderSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  type: z.enum(PROVIDER_TYPE_VALUES, "Selecciona un tipo válido."),
  name: z
    .string()
    .trim()
    .min(1, "El nombre del proveedor es obligatorio.")
    .max(200, "El nombre es demasiado largo."),
  specialty: nullableTrimmedString(100, "La especialidad"),
  phone: nullableTrimmedString(30, "El teléfono"),
  organization: nullableTrimmedString(200, "La organización"),
  notes: nullableTrimmedString(1000, "Las notas"),
});
export type CreatePersonProviderInput = z.infer<typeof createPersonProviderSchema>;

export const updatePersonProviderSchema = z.object({
  type: z.enum(PROVIDER_TYPE_VALUES, "Selecciona un tipo válido.").optional(),
  name: z
    .string()
    .trim()
    .min(1, "El nombre del proveedor es obligatorio.")
    .max(200, "El nombre es demasiado largo.")
    .optional(),
  specialty: nullableTrimmedString(100, "La especialidad"),
  phone: nullableTrimmedString(30, "El teléfono"),
  organization: nullableTrimmedString(200, "La organización"),
  notes: nullableTrimmedString(1000, "Las notas"),
});
export type UpdatePersonProviderInput = z.infer<typeof updatePersonProviderSchema>;
