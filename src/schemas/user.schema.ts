import { z } from "zod";

export const USER_ROLE_VALUES = ["ADMIN", "AGENT", "ASSISTANT"] as const;

export const userIdSchema = z.uuid("Identificador de usuario inválido.");

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido.").max(200),
  email: z.email("Correo electrónico inválido.").trim().toLowerCase(),
  role: z.enum(USER_ROLE_VALUES, "Selecciona un rol válido."),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserActiveSchema = z.object({
  id: userIdSchema,
  isActive: z.boolean(),
});
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;
