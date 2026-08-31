import { z } from "zod";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";

export const productIdSchema = z.uuid("Identificador de producto inválido.");

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  carrierId: z.uuid().optional(),
  policyType: z.enum(POLICY_TYPE_VALUES).optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const nameSchema = z.string().trim().min(1, "El nombre es requerido.").max(200);
const isActiveSchema = z.enum(["true", "false"]).transform((v) => v === "true");
const planYearSchema = z.coerce.number().int().min(2000).max(2100);
const externalCodeSchema = z.string().trim().min(1).max(100);

export const createProductSchema = z.object({
  carrierId: z.uuid("Selecciona una compañía válida."),
  name: nameSchema,
  policyType: z.enum(POLICY_TYPE_VALUES, "Selecciona un tipo de seguro válido."),
  planYear: planYearSchema.optional(),
  externalCode: externalCodeSchema.optional(),
  isActive: isActiveSchema.default(true),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Campos que no pueden cambiar una vez el producto fue usado por al
// menos una Policy (ver docs/DECISIONS.md) — carrierId, policyType,
// planYear. name/externalCode/isActive siguen editables siempre.
export const IMMUTABLE_AFTER_USE_FIELDS = ["carrierId", "policyType", "planYear"] as const;

export const updateProductSchema = z.object({
  carrierId: z.uuid("Selecciona una compañía válida.").optional(),
  name: nameSchema.optional(),
  policyType: z.enum(POLICY_TYPE_VALUES).optional(),
  planYear: planYearSchema.optional(),
  externalCode: externalCodeSchema.optional(),
  isActive: isActiveSchema.optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
