import { z } from "zod";
import { userIdSchema } from "@/schemas/user.schema";

// CORRECCIÓN (activación de usuarios) — activar una cuenta nueva a
// partir de un enlace de invitación de un solo uso. Misma política de
// contraseña ya configurada en auth.ts (minPasswordLength: 10) y
// reutilizada en resetUserPasswordSchema.
export const activateAccountSchema = z
  .object({
    userId: userIdSchema,
    token: z.string().trim().min(1, "Enlace inválido."),
    newPassword: z.string().min(10, "La contraseña debe tener al menos 10 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });
export type ActivateAccountInput = z.infer<typeof activateAccountSchema>;

export const resendInvitationSchema = z.object({
  userId: userIdSchema,
});
export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>;
