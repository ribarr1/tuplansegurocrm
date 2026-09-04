import { z } from "zod";
import { policyIdSchema } from "@/schemas/policy.schema";

// ---------------------------------------------------------------------------
// Vault de credenciales de portales — Fase 025 (Parte J).
//
// CRÍTICO: username/password NUNCA se validan con transform ni se
// normalizan (a diferencia de SSN/USCIS) — son texto libre tal como el
// portal externo los exige (pueden incluir mayúsculas, símbolos,
// espacios). No se imponen reglas de complejidad aquí: este vault
// GUARDA credenciales de sistemas de terceros, no las crea.
// ---------------------------------------------------------------------------

export const userIdSchema = z.uuid("Identificador de usuario inválido.");
export const personIdSchema = z.uuid("Identificador de persona inválido.");
export const agentPortalCredentialIdSchema = z.uuid("Identificador de credencial inválido.");
export const clientPortalCredentialIdSchema = z.uuid("Identificador de credencial inválido.");

export const CLIENT_PORTAL_TYPE_VALUES = ["CARRIER", "MARKETPLACE", "STATE_EXCHANGE", "OTHER"] as const;

const portalNameSchema = z.string().trim().min(1, "El nombre del portal es obligatorio.").max(200);
const portalUrlSchema = z.string().trim().min(1, "La URL del portal es obligatoria.").max(500);
const usernameSchema = z.string().min(1, "El usuario es obligatorio.").max(300);
const passwordSchema = z.string().min(1, "La contraseña es obligatoria.").max(500);
const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// ---------------------------------------------------------------------------
// AgentPortalCredential
// ---------------------------------------------------------------------------

export const createAgentPortalCredentialSchema = z.object({
  userId: userIdSchema,
  carrierId: z.uuid("Selecciona una compañía válida.").optional(),
  portalName: portalNameSchema,
  portalUrl: portalUrlSchema,
  username: usernameSchema,
  password: passwordSchema,
  notes: notesSchema,
});
export type CreateAgentPortalCredentialInput = z.infer<typeof createAgentPortalCredentialSchema>;

export const updateAgentPortalCredentialSchema = z.object({
  carrierId: z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), z.uuid()]))
    .optional(),
  portalName: portalNameSchema.optional(),
  portalUrl: portalUrlSchema.optional(),
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  notes: z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .optional(),
});
export type UpdateAgentPortalCredentialInput = z.infer<typeof updateAgentPortalCredentialSchema>;

// ---------------------------------------------------------------------------
// ClientPortalCredential
// ---------------------------------------------------------------------------

export const createClientPortalCredentialSchema = z.object({
  personId: personIdSchema,
  carrierId: z.uuid("Selecciona una compañía válida.").optional(),
  policyId: policyIdSchema.optional(),
  portalType: z.enum(CLIENT_PORTAL_TYPE_VALUES, "Selecciona un tipo de portal válido."),
  portalName: portalNameSchema,
  portalUrl: portalUrlSchema,
  username: usernameSchema,
  password: passwordSchema,
});
export type CreateClientPortalCredentialInput = z.infer<typeof createClientPortalCredentialSchema>;

export const updateClientPortalCredentialSchema = z.object({
  portalType: z.enum(CLIENT_PORTAL_TYPE_VALUES).optional(),
  portalName: portalNameSchema.optional(),
  portalUrl: portalUrlSchema.optional(),
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
});
export type UpdateClientPortalCredentialInput = z.infer<typeof updateClientPortalCredentialSchema>;

export const CREDENTIAL_FIELD_VALUES = ["username", "password"] as const;
export const credentialFieldSchema = z.enum(CREDENTIAL_FIELD_VALUES, "Campo inválido.");
