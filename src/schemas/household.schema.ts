import { z } from "zod";
import { US_STATE_CODES } from "@/lib/us-states";

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

// Dirección + ingreso familiar — Fase 019.5. Mismo patrón de 3 estados
// que health-policy.schema.ts: clave ausente en el FormData -> no
// tocar; clave presente vacía -> null explícito; clave con valor -> se
// valida. La pantalla de edición envía todos los campos siempre, así
// que en la práctica solo se usan los últimos dos estados.
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

// Hallazgo #15.4 de UAT (Fase 019.7): el estado debe venir de un
// catálogo controlado (US_STATE_CODES, src/lib/us-states.ts) — nunca
// un valor arbitrario tipo "Ill"/"ilinois". Antes solo se validaba el
// formato (2 letras), lo que aceptaba abreviaciones inexistentes.
const stateCodeSchema = z
  .string()
  .transform((v) => {
    const trimmed = v.trim().toUpperCase();
    return trimmed === "" ? null : trimmed;
  })
  .pipe(
    z.union([
      z.null(),
      z.enum(US_STATE_CODES, "Selecciona un estado válido del catálogo."),
    ])
  )
  .optional();

const incomeAmountSchema = z
  .string()
  .transform((v) => {
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  })
  .pipe(
    z.union([
      z.null(),
      z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 72000.00)."),
    ])
  )
  .optional();

const incomeYearSchema = z
  .string()
  .transform((v, ctx) => {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const year = Number(trimmed);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      ctx.addIssue({ code: "custom", message: "Año inválido." });
      return z.NEVER;
    }
    return year;
  })
  .optional();

export const updateHouseholdSchema = z.object({
  addressLine1: nullableTrimmedString(200, "La dirección"),
  addressLine2: nullableTrimmedString(200, "La dirección (línea 2)"),
  city: nullableTrimmedString(100, "La ciudad"),
  state: stateCodeSchema,
  zipCode: nullableTrimmedString(10, "El ZIP"),
  county: nullableTrimmedString(100, "El condado"),
  annualHouseholdIncome: incomeAmountSchema,
  incomeYear: incomeYearSchema,
});
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
