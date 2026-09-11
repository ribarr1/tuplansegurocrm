import { z } from "zod";

// PREPRODUCCIÓN — MFA. Un código TOTP siempre son 6 dígitos (ver
// node_modules/better-auth/dist/plugins/two-factor/totp/index.mjs —
// digits por defecto 6, nunca cambiado en auth.ts).
const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Ingresa el código de 6 dígitos de tu app de autenticación.");

export const startTotpEnrollmentSchema = z.object({
  password: z.string().min(1, "Confirma tu contraseña actual."),
});
export type StartTotpEnrollmentInput = z.infer<typeof startTotpEnrollmentSchema>;

export const confirmTotpEnrollmentSchema = z.object({
  code: totpCodeSchema,
});
export type ConfirmTotpEnrollmentInput = z.infer<typeof confirmTotpEnrollmentSchema>;

export const regenerateBackupCodesSchema = z.object({
  password: z.string().min(1, "Confirma tu contraseña actual."),
  code: totpCodeSchema,
});
export type RegenerateBackupCodesInput = z.infer<typeof regenerateBackupCodesSchema>;

export const disableTotpSchema = z.object({
  password: z.string().min(1, "Confirma tu contraseña actual."),
  code: totpCodeSchema,
});
export type DisableTotpInput = z.infer<typeof disableTotpSchema>;
