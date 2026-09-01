import { z } from "zod";
import { periodSchema } from "@/schemas/commission.schema";

export const COMMISSION_METHOD_VALUES = ["FIXED_AMOUNT", "PERCENTAGE"] as const;
export const COMMISSION_BASE_VALUES = [
  "PREMIUM_MONTHLY",
  "PREMIUM_ANNUALIZED",
  "PER_MEMBER",
  "FIXED",
  "OTHER",
] as const;
export const COMMISSION_PERIODICITY_VALUES = ["ONE_TIME", "MONTHLY", "ANNUAL"] as const;

export const commissionRuleIdSchema = z.uuid("Identificador de regla inválido.");

const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 25.00).");

const percentageSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Ingresa un porcentaje válido (ej. 80.00).")
  .refine((v) => Number(v) <= 100, "El porcentaje no puede ser mayor a 100.");

// method decide cuál de los dos pares (Amount/Percentage) se usa —
// validado con superRefine porque depende de más de un campo a la vez
// (ver docs/DECISIONS.md).
export const createCommissionRuleSchema = z
  .object({
    productId: z.uuid("Selecciona un producto válido."),
    policyId: z.uuid("Selecciona una póliza válida.").optional(),
    method: z.enum(COMMISSION_METHOD_VALUES, "Selecciona un método válido."),
    base: z.enum(COMMISSION_BASE_VALUES, "Selecciona una base válida."),
    initialAmount: decimalAmountSchema.optional(),
    initialPercentage: percentageSchema.optional(),
    initialPeriodicity: z.enum(COMMISSION_PERIODICITY_VALUES, "Selecciona una periodicidad válida."),
    residualEnabled: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    residualAmount: decimalAmountSchema.optional(),
    residualPercentage: percentageSchema.optional(),
    residualPeriodicity: z.enum(COMMISSION_PERIODICITY_VALUES).optional(),
    residualStartYear: z.coerce.number().int().min(1).max(50).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === "FIXED_AMOUNT" && !data.initialAmount) {
      ctx.addIssue({ code: "custom", message: "Ingresa el monto inicial.", path: ["initialAmount"] });
    }
    if (data.method === "PERCENTAGE" && !data.initialPercentage) {
      ctx.addIssue({ code: "custom", message: "Ingresa el porcentaje inicial.", path: ["initialPercentage"] });
    }
    if (data.residualEnabled) {
      if (!data.residualPeriodicity) {
        ctx.addIssue({ code: "custom", message: "Selecciona la periodicidad del residual.", path: ["residualPeriodicity"] });
      }
      if (!data.residualStartYear) {
        ctx.addIssue({ code: "custom", message: "Indica desde qué año de póliza aplica el residual.", path: ["residualStartYear"] });
      }
      if (data.method === "FIXED_AMOUNT" && !data.residualAmount) {
        ctx.addIssue({ code: "custom", message: "Ingresa el monto residual.", path: ["residualAmount"] });
      }
      if (data.method === "PERCENTAGE" && !data.residualPercentage) {
        ctx.addIssue({ code: "custom", message: "Ingresa el porcentaje residual.", path: ["residualPercentage"] });
      }
    }
  });
export type CreateCommissionRuleInput = z.infer<typeof createCommissionRuleSchema>;

export const generateExpectationsSchema = z.object({
  policyId: z.uuid("Selecciona una póliza válida."),
  period: periodSchema,
});
export type GenerateExpectationsInput = z.infer<typeof generateExpectationsSchema>;
