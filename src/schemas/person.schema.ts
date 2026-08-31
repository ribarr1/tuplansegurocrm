import { z } from "zod";
import { optionalSearchFilter } from "@/schemas/common";

// Valores reales de ContactStatus (prisma/schema.prisma). Duplicado aquí
// como literales porque Zod no puede importar un enum de Prisma
// directamente en un schema portable a cliente/servidor; si el enum de
// negocio cambia, este array debe actualizarse junto con la migración.
export const CONTACT_STATUS_VALUES = [
  "PROSPECT",
  "CLIENT",
  "FORMER_CLIENT",
  "OTHER",
] as const;

export const personIdSchema = z.uuid();

export const listPeopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  contactStatus: z.enum(CONTACT_STATUS_VALUES).optional(),
});
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;

// Campos reales de Person (prisma/schema.prisma) — sin address ni
// datos demográficos (sex/preferredLanguage/countryOfOrigin), que
// deliberadamente no existen todavía en el modelo (ver docs/DECISIONS.md).
// Mensajes en español y legibles: llegan tal cual hasta la UI (ver
// services/errors.ts::parseOrThrow), nunca el texto técnico por
// defecto de Zod.
const personFieldsSchema = {
  firstName: z.string().trim().min(1, "El nombre es requerido.").max(100),
  middleName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1, "El apellido es requerido.").max(100),
  secondLastName: z.string().trim().min(1).max(100).optional(),
  preferredName: z.string().trim().min(1).max(100).optional(),
  // No en el futuro: fecha de nacimiento no puede ser posterior a hoy.
  dateOfBirth: z.coerce
    .date()
    .max(new Date(), "La fecha de nacimiento no puede ser en el futuro.")
    .optional(),
  email: z.email("Correo electrónico inválido.").optional(),
  // Validación básica de longitud, sin normalización estricta E.164 —
  // el dato llega en formatos variados desde el proceso actual.
  phone: z
    .string()
    .trim()
    .min(7, "El teléfono debe tener al menos 7 caracteres.")
    .max(20, "El teléfono es demasiado largo.")
    .optional(),
  contactStatus: z.enum(CONTACT_STATUS_VALUES).default("PROSPECT"),
  source: z.string().trim().min(1).max(200).optional(),
  // La política de quién puede asignar/a quién se resuelve en el
  // servicio (people.service.ts), no aquí — este schema solo valida
  // que, si viene, sea un UUID.
  assignedAgentId: z.uuid("Selecciona un agente válido.").optional(),
};

export const createPersonSchema = z.object(personFieldsSchema);
export type CreatePersonInput = z.infer<typeof createPersonSchema>;

export const updatePersonSchema = z.object(personFieldsSchema).partial();
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
