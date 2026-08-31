import { z } from "zod";

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
  search: z.string().trim().min(1).max(200).optional(),
  contactStatus: z.enum(CONTACT_STATUS_VALUES).optional(),
});
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;

// Campos reales de Person (prisma/schema.prisma) — sin address ni
// datos demográficos (sex/preferredLanguage/countryOfOrigin), que
// deliberadamente no existen todavía en el modelo (ver docs/DECISIONS.md).
const personFieldsSchema = {
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100),
  secondLastName: z.string().trim().min(1).max(100).optional(),
  preferredName: z.string().trim().min(1).max(100).optional(),
  // No en el futuro: fecha de nacimiento no puede ser posterior a hoy.
  dateOfBirth: z.coerce.date().max(new Date()).optional(),
  email: z.email().optional(),
  // Validación básica de longitud, sin normalización estricta E.164 —
  // el dato llega en formatos variados desde el proceso actual.
  phone: z.string().trim().min(7).max(20).optional(),
  contactStatus: z.enum(CONTACT_STATUS_VALUES).default("PROSPECT"),
  source: z.string().trim().min(1).max(200).optional(),
  // La política de quién puede asignar/a quién se resuelve en el
  // servicio (people.service.ts), no aquí — este schema solo valida
  // que, si viene, sea un UUID.
  assignedAgentId: z.uuid().optional(),
};

export const createPersonSchema = z.object(personFieldsSchema);
export type CreatePersonInput = z.infer<typeof createPersonSchema>;

export const updatePersonSchema = z.object(personFieldsSchema).partial();
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
