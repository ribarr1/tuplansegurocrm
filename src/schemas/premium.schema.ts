import { z } from "zod";
import { optionalSearchFilter, optionalUuidFilter } from "@/schemas/common";
import { BILLING_FREQUENCY_VALUES, PAYMENT_STATUS_VALUES } from "@/schemas/policy.schema";

// Valores true/false que llegan como string desde <form method="GET">
// (checkboxes/vistas rápidas) — mismo patrón que Task.dueToday/overdueOnly.
function optionalBooleanFilter() {
  return z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional();
}

export const listPremiumTrackingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  // Vistas rápidas — no se guardan como estado, son filtros derivados
  // sobre nextPaymentDueDate/paymentStatus (ver premiums.service.ts).
  dueToday: optionalBooleanFilter(),
  next7Days: optionalBooleanFilter(),
  next30Days: optionalBooleanFilter(),
  overdueOnly: optionalBooleanFilter(),
  needsAssistance: optionalBooleanFilter(),
  autopay: optionalBooleanFilter(),
  paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
  carrierId: optionalUuidFilter(),
  agentId: optionalUuidFilter(),
});
export type ListPremiumTrackingQuery = z.infer<typeof listPremiumTrackingQuerySchema>;

const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 125.50).");

// Mismo patrón de 3 estados que health-policy.schema.ts: clave ausente
// -> no tocar; clave presente vacía -> null explícito; clave con valor
// -> se valida. Este formulario siempre envía las 4 claves nullable
// (premiumAmount/billingFrequency/nextPaymentDueDate/paymentStatus),
// así que en la práctica solo se usan los últimos dos estados — el
// primero queda disponible por si en el futuro se reutiliza este
// schema desde un formulario parcial.
function nullableDecimal() {
  return z
    .string()
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), decimalAmountSchema]))
    .optional();
}

function nullableEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), z.enum(values)]))
    .optional();
}

// nextPaymentDueDate es @db.Date — un <input type="date"> entrega
// "2026-08-15", que new Date(...) interpreta como medianoche UTC (regla
// ECMA-262 para strings solo-fecha), exactamente lo que Prisma espera
// para esta columna. No requiere ninguna conversión de zona horaria
// (a diferencia de un datetime-local, ver task.schema.ts::dueAt).
function nullableDateOnly() {
  return z
    .string()
    .transform((v, ctx) => {
      const trimmed = v.trim();
      if (trimmed === "") return null;
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: "custom", message: "Fecha inválida." });
        return z.NEVER;
      }
      return date;
    })
    .optional();
}

// autopay/needsPaymentAssistance no son nullable en Policy (Boolean
// @default(false)) — el formulario siempre envía "true"/"false"
// explícito (mismo truco que PolicyForm: checkbox desmarcado no viaja
// en FormData, form-helpers.ts lo normaliza antes de llegar aquí), así
// que no necesitan el patrón de 3 estados.
const booleanFieldSchema = z.enum(["true", "false"]).transform((v) => v === "true");

// Solo los 6 campos de seguimiento de pago — nunca policyNumber,
// status, effectiveDate, productId, etc. Este schema es la única
// puerta de entrada de "Editar seguimiento de pago"; no reutiliza
// updatePolicySchema a propósito, para que sea imposible colar un
// campo fuera de alcance por accidente.
export const updatePremiumTrackingSchema = z.object({
  premiumAmount: nullableDecimal(),
  billingFrequency: nullableEnum(BILLING_FREQUENCY_VALUES),
  nextPaymentDueDate: nullableDateOnly(),
  paymentStatus: nullableEnum(PAYMENT_STATUS_VALUES),
  autopay: booleanFieldSchema,
  needsPaymentAssistance: booleanFieldSchema,
});
export type UpdatePremiumTrackingInput = z.infer<typeof updatePremiumTrackingSchema>;
