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

// Fase 022 (Hallazgo #4 de UAT) — Restablecer contraseña. Misma
// política mínima ya configurada en auth.ts (minPasswordLength: 10).
// confirmPassword se valida aquí (nunca solo en el cliente) para que
// un error de tipeo no quede silenciosamente ignorado.
export const resetUserPasswordSchema = z
  .object({
    id: userIdSchema,
    newPassword: z.string().min(10, "La contraseña debe tener al menos 10 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
