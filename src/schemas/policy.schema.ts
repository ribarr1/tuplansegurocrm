import { z } from "zod";
import { optionalSearchFilter, optionalUuidFilter, optionalEnumFilter } from "@/schemas/common";

// Valores reales de los enums de Policy (prisma/schema.prisma), duplicados
// aquí como literales por la misma razón que en person.schema.ts /
// household.schema.ts: Zod no puede importar un enum de Prisma
// directamente en un schema portable a cliente/servidor.
export const POLICY_TYPE_VALUES = [
  "HEALTH",
  "LIFE",
  "SUPPLEMENTAL",
  "DENTAL",
  "FINAL_EXPENSE",
] as const;

export const POLICY_STATUS_VALUES = ["PENDING", "ACTIVE", "CANCELLED", "EXPIRED"] as const;

export const POLICY_OPERATION_TYPE_VALUES = [
  "NEW_ENROLLMENT",
  "RENEWAL",
  "PLAN_CHANGE",
] as const;

// PRIMARY se excluye deliberadamente de los roles seleccionables para un
// "covered member" — PRIMARY está reservado exclusivamente para el
// titular cuando holderCovered = true (ver policies.service.ts).
export const POLICY_MEMBER_ROLE_VALUES = ["PRIMARY", "SPOUSE", "DEPENDENT", "OTHER"] as const;
export const COVERED_MEMBER_ROLE_VALUES = ["SPOUSE", "DEPENDENT", "OTHER"] as const;

export const BILLING_FREQUENCY_VALUES = [
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
  "OTHER",
] as const;

export const PAYMENT_STATUS_VALUES = ["CURRENT", "DUE", "PAST_DUE"] as const;

// Fase 019.5 — solo aplica a pólizas HEALTH, regla de aplicación (ver
// docs/DECISIONS.md).
export const HEALTH_COVERAGE_SOURCE_VALUES = ["MARKETPLACE", "PRIVATE"] as const;

export const policyIdSchema = z.uuid("Identificador de póliza inválido.");

// Decimal como string validado, nunca number — evita aritmética de punto
// flotante en un monto financiero. Prisma acepta un string validado
// directamente para un campo Decimal.
const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 125.50).")
  .refine((v) => Number(v) >= 0, "El monto no puede ser negativo.");

const coveredMemberSchema = z.object({
  personId: z.uuid("Selecciona una persona válida."),
  role: z.enum(COVERED_MEMBER_ROLE_VALUES, "Selecciona un rol de cobertura válido."),
});

// Fase 019.7 (hallazgo #12) — agregar un miembro a una póliza ya
// existente, por separado de la creación de la póliza.
export const policyMemberIdSchema = z.uuid("Identificador de miembro inválido.");

export const addPolicyMemberSchema = z.object({
  personId: z.uuid("Selecciona una persona válida."),
  role: z.enum(COVERED_MEMBER_ROLE_VALUES, "Selecciona un rol de cobertura válido."),
});

export const listPoliciesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  status: optionalEnumFilter(POLICY_STATUS_VALUES),
  policyType: optionalEnumFilter(POLICY_TYPE_VALUES),
  carrierId: optionalUuidFilter(),
  healthSource: optionalEnumFilter(HEALTH_COVERAGE_SOURCE_VALUES),
});
export type ListPoliciesQuery = z.infer<typeof listPoliciesQuerySchema>;

export const createPolicySchema = z
  .object({
    holderId: z.uuid("Selecciona un titular válido."),
    productId: z.uuid("Selecciona un producto válido."),
    holderCovered: z.enum(["true", "false"]).transform((v) => v === "true"),
    coveredMembers: z.array(coveredMemberSchema).default([]),
    policyNumber: z.string().trim().min(1).max(100).optional(),
    status: z.enum(POLICY_STATUS_VALUES).default("PENDING"),
    effectiveDate: z.coerce.date().optional(),
    terminationDate: z.coerce.date().optional(),
    premiumAmount: decimalAmountSchema.optional(),
    billingFrequency: z.enum(BILLING_FREQUENCY_VALUES).optional(),
    nextPaymentDueDate: z.coerce.date().optional(),
    autopay: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    needsPaymentAssistance: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
    operationType: z.enum(POLICY_OPERATION_TYPE_VALUES).default("NEW_ENROLLMENT"),
    // Solo ADMIN puede enviar un valor distinto de sí mismo — la
    // política real se resuelve en el servicio, este schema solo valida
    // forma (uuid si viene).
    processedById: z.uuid("Selecciona un usuario válido.").optional(),
    // Solo tiene efecto real si el producto es HEALTH — el servicio lo
    // ignora silenciosamente para el resto (nunca lo rechaza, para no
    // obligar a la UI a condicionar el envío del campo).
    healthCoverageSource: z.enum(HEALTH_COVERAGE_SOURCE_VALUES).optional(),
  })
  .refine((data) => data.status !== "ACTIVE" || data.effectiveDate !== undefined, {
    message: "La fecha efectiva es requerida cuando el estado es Activa.",
    path: ["effectiveDate"],
  });
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

// Sin holderId/productId/coveredMembers — la edición V1 no toca
// titular, producto (salvo regla PENDING, resuelta en el servicio) ni
// miembros cubiertos (ver docs/DECISIONS.md).
export const updatePolicySchema = z
  .object({
    productId: z.uuid("Selecciona un producto válido.").optional(),
    policyNumber: z.string().trim().min(1).max(100).optional(),
    status: z.enum(POLICY_STATUS_VALUES).optional(),
    effectiveDate: z.coerce.date().optional(),
    terminationDate: z.coerce.date().optional(),
    premiumAmount: decimalAmountSchema.optional(),
    billingFrequency: z.enum(BILLING_FREQUENCY_VALUES).optional(),
    nextPaymentDueDate: z.coerce.date().optional(),
    autopay: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    needsPaymentAssistance: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
    operationType: z.enum(POLICY_OPERATION_TYPE_VALUES).optional(),
    processedById: z.uuid("Selecciona un usuario válido.").optional(),
    // 3 estados (ausente/vacío/valor) porque a diferencia de crear, aquí
    // sí debe poder "desclasificarse" explícitamente (volver a null).
    healthCoverageSource: z
      .string()
      .transform((v) => (v.trim() === "" ? null : v.trim()))
      .pipe(z.union([z.null(), z.enum(HEALTH_COVERAGE_SOURCE_VALUES)]))
      .optional(),
  })
  .partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

// Renovación de póliza (Fase 019.9, §3-§4) — mismo shape que
// createPolicySchema salvo `holderId` (siempre el titular de la
// póliza anterior, nunca editable en este flujo) y `operationType`
// (default RENEWAL en vez de NEW_ENROLLMENT; el usuario puede cambiarlo
// a PLAN_CHANGE/REPLACEMENT si en realidad no es una renovación pura —
// evita un campo "reason" paralelo, reutiliza el enum ya existente).
// policyNumber/effectiveDate/terminationDate deliberadamente NO se
// prefijan desde la UI — siempre en blanco, el usuario los introduce
// de nuevo.
export const renewPolicySchema = z
  .object({
    productId: z.uuid("Selecciona un producto válido."),
    holderCovered: z.enum(["true", "false"]).transform((v) => v === "true"),
    coveredMembers: z.array(coveredMemberSchema).default([]),
    policyNumber: z.string().trim().min(1).max(100).optional(),
    status: z.enum(POLICY_STATUS_VALUES).default("PENDING"),
    effectiveDate: z.coerce.date().optional(),
    terminationDate: z.coerce.date().optional(),
    premiumAmount: decimalAmountSchema.optional(),
    billingFrequency: z.enum(BILLING_FREQUENCY_VALUES).optional(),
    nextPaymentDueDate: z.coerce.date().optional(),
    autopay: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    needsPaymentAssistance: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
    operationType: z.enum(POLICY_OPERATION_TYPE_VALUES).default("RENEWAL"),
    processedById: z.uuid("Selecciona un usuario válido.").optional(),
    healthCoverageSource: z.enum(HEALTH_COVERAGE_SOURCE_VALUES).optional(),
  })
  .refine((data) => data.status !== "ACTIVE" || data.effectiveDate !== undefined, {
    message: "La fecha efectiva es requerida cuando el estado es Activa.",
    path: ["effectiveDate"],
  });
export type RenewPolicyInput = z.infer<typeof renewPolicySchema>;

// Cancelación guiada — Fase 020 (§4). terminationDate siempre
// requerida (a diferencia de updatePolicySchema, donde es opcional);
// reason es opcional y NUNCA se guarda en una columna nueva de Policy
// — vive en AuditEvent.metadata (ver policies.service.ts::cancelPolicy
// y docs/DECISIONS.md).
export const cancelPolicySchema = z.object({
  terminationDate: z.coerce.date({ error: "Selecciona una fecha de terminación válida." }),
  reason: z.string().trim().max(500).optional(),
});
export type CancelPolicyInput = z.infer<typeof cancelPolicySchema>;

export const listActiveProductsQuerySchema = z.object({
  policyType: optionalEnumFilter(POLICY_TYPE_VALUES),
  carrierId: optionalUuidFilter(),
});
export type ListActiveProductsQuery = z.infer<typeof listActiveProductsQuerySchema>;
