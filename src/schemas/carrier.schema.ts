import { z } from "zod";

export const carrierIdSchema = z.uuid("Identificador de compañía inválido.");

export const listCarriersQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListCarriersQuery = z.infer<typeof listCarriersQuerySchema>;

const nameSchema = z.string().trim().min(1, "El nombre es requerido.").max(200);
const isActiveSchema = z.enum(["true", "false"]).transform((v) => v === "true");

export const createCarrierSchema = z.object({
  name: nameSchema,
  isActive: isActiveSchema.default(true),
});
export type CreateCarrierInput = z.infer<typeof createCarrierSchema>;

export const updateCarrierSchema = z.object({
  name: nameSchema.optional(),
  isActive: isActiveSchema.optional(),
});
export type UpdateCarrierInput = z.infer<typeof updateCarrierSchema>;
