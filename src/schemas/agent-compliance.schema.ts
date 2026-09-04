import { z } from "zod";
import { US_STATE_CODES } from "@/lib/us-states";
import { dateOnlySchema } from "@/schemas/common";
import { policyTypeSchema } from "@/schemas/policy.schema";

// Fase 025 (Parte G/H): licencias y contratos de agente. Reutiliza el
// catálogo de 2 letras ya existente (US_STATE_CODES, us-states.ts) —
// nunca un segundo catálogo de estados paralelo.

export const userIdSchema = z.uuid("Identificador de usuario inválido.");

export const AGENT_LICENSE_STATUS_VALUES = ["ACTIVE", "INACTIVE", "EXPIRED"] as const;

export const agentLicenseIdSchema = z.uuid("Identificador de licencia inválido.");

export const createAgentLicenseSchema = z.object({
  userId: userIdSchema,
  state: z.enum(US_STATE_CODES, "Selecciona un estado válido."),
  status: z.enum(AGENT_LICENSE_STATUS_VALUES).default("ACTIVE"),
  licenseNumber: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  effectiveDate: dateOnlySchema().optional(),
  expirationDate: dateOnlySchema().optional(),
});
export type CreateAgentLicenseInput = z.infer<typeof createAgentLicenseSchema>;

export const updateAgentLicenseSchema = z.object({
  status: z.enum(AGENT_LICENSE_STATUS_VALUES).optional(),
  licenseNumber: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v === "" ? null : v)),
  effectiveDate: dateOnlySchema().optional(),
  expirationDate: dateOnlySchema().optional(),
});
export type UpdateAgentLicenseInput = z.infer<typeof updateAgentLicenseSchema>;

// ---------------------------------------------------------------------------

export const AGENT_CONTRACT_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;

export const agentCarrierContractIdSchema = z.uuid("Identificador de contrato inválido.");

// Un contrato se registra por (carrier, policyType, UN estado) — el
// formulario acepta múltiples estados y el servicio crea una fila por
// cada uno (nunca un array opaco, ver docs/DECISIONS.md).
export const createAgentCarrierContractSchema = z.object({
  userId: userIdSchema,
  carrierId: z.uuid("Selecciona una compañía válida."),
  policyType: policyTypeSchema,
  states: z.array(z.enum(US_STATE_CODES)).min(1, "Selecciona al menos un estado."),
  status: z.enum(AGENT_CONTRACT_STATUS_VALUES).default("ACTIVE"),
  effectiveDate: dateOnlySchema().optional(),
  terminationDate: dateOnlySchema().optional(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
export type CreateAgentCarrierContractInput = z.infer<typeof createAgentCarrierContractSchema>;

export const updateAgentCarrierContractSchema = z.object({
  status: z.enum(AGENT_CONTRACT_STATUS_VALUES).optional(),
  effectiveDate: dateOnlySchema().optional(),
  terminationDate: dateOnlySchema().optional(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === "" ? null : v)),
});
export type UpdateAgentCarrierContractInput = z.infer<typeof updateAgentCarrierContractSchema>;
