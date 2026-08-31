import { z } from "zod";

// Valores reales de HouseholdMemberRole (prisma/schema.prisma).
// Duplicado aquí como literales por la misma razón que
// CONTACT_STATUS_VALUES en person.schema.ts.
export const HOUSEHOLD_MEMBER_ROLE_VALUES = [
  "HEAD",
  "SPOUSE",
  "CHILD",
  "DEPENDENT",
  "OTHER",
] as const;

export const householdIdSchema = z.uuid("Identificador de hogar inválido.");
export const householdMemberIdSchema = z.uuid("Identificador de miembro inválido.");

export const createHouseholdSchema = z.object({
  personId: z.uuid("Selecciona una persona válida."),
  role: z.enum(HOUSEHOLD_MEMBER_ROLE_VALUES, "Selecciona un rol válido."),
  name: z.string().trim().min(1).max(200).optional(),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const addHouseholdMemberSchema = z.object({
  personId: z.uuid("Selecciona una persona válida."),
  role: z.enum(HOUSEHOLD_MEMBER_ROLE_VALUES, "Selecciona un rol válido."),
});
export type AddHouseholdMemberInput = z.infer<typeof addHouseholdMemberSchema>;

export const updateHouseholdMemberRoleSchema = z.object({
  role: z.enum(HOUSEHOLD_MEMBER_ROLE_VALUES, "Selecciona un rol válido."),
});
export type UpdateHouseholdMemberRoleInput = z.infer<typeof updateHouseholdMemberRoleSchema>;

export const searchPeopleSchema = z.object({
  search: z.string().trim().min(1, "Escribe algo para buscar.").max(200),
});
