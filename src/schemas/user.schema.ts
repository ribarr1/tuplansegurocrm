import { z } from "zod";

export const USER_ROLE_VALUES = ["ADMIN", "AGENT", "ASSISTANT"] as const;

export const userIdSchema = z.uuid("Identificador de usuario inválido.");

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido.").max(200),
  // Normaliza (trim/minúsculas) ANTES de validar el formato — ver
  // nota en password-recovery.service.ts sobre por qué el orden
  // z.email().trim() no normaliza de verdad (valida antes de recortar
  // espacios, y los rechazaría).
  email: z.string().trim().toLowerCase().pipe(z.email("Correo electrónico inválido.")),
  role: z.enum(USER_ROLE_VALUES, "Selecciona un rol válido."),
  // Fase 025.4 (UAT-03/07): "¿Este usuario también es agente?" —
  // irrelevante cuando role=AGENT (siempre true, ver
  // users.service.ts::createUser), default false para ADMIN/ASSISTANT
  // — nunca se asume.
  isAgent: z.boolean().default(false),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserActiveSchema = z.object({
  id: userIdSchema,
  isActive: z.boolean(),
});
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

export const setUserIsAgentSchema = z.object({
  id: userIdSchema,
  isAgent: z.boolean(),
});
export type SetUserIsAgentInput = z.infer<typeof setUserIsAgentSchema>;

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
