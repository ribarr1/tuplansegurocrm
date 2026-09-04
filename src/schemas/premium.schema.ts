import { z } from "zod";
import {
  optionalSearchFilter,
  optionalUuidFilter,
  optionalEnumFilter,
  optionalBooleanFilter,
  isValidDateOnlyString,
} from "@/schemas/common";
import {
  BILLING_FREQUENCY_VALUES,
  PAYMENT_STATUS_VALUES,
  paymentManagementModeSchema,
} from "@/schemas/policy.schema";

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
  paymentStatus: optionalEnumFilter(PAYMENT_STATUS_VALUES),
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

// nextPaymentDueDate es @db.Date — un <input type="date"> (o
// USDateInput) entrega "YYYY-MM-DD". Fase 022 (Hallazgo #1 de UAT):
// NUNCA usar `new Date(string)` directamente para validar esto — es
// lenienta con días de calendario inválidos (ej. "2026-02-30" se
// "redondea" silenciosamente a marzo en vez de rechazarse). Se valida
// con isValidDateOnlyString (mismo validador centralizado que
// dateOnlySchema, common.ts) antes de construir el Date.
function nullableDateOnly() {
  return z
    .string()
    .transform((v, ctx) => {
      const trimmed = v.trim();
      if (trimmed === "") return null;
      if (!isValidDateOnlyString(trimmed)) {
        ctx.addIssue({ code: "custom", message: "Fecha inválida. Verifica día y mes." });
        return z.NEVER;
      }
      return new Date(`${trimmed}T00:00:00.000Z`);
    })
    .optional();
}

// Solo los 6 campos de seguimiento de pago — nunca policyNumber,
// status, effectiveDate, productId, etc. Este schema es la única
// puerta de entrada de "Editar seguimiento de pago"; no reutiliza
// updatePolicySchema a propósito, para que sea imposible colar un
// campo fuera de alcance por accidente. Fase 025 (Hallazgo #3):
// paymentManagementMode reemplaza autopay/needsPaymentAssistance como
// campo editable — el servicio deriva ambos booleanos a partir de él.
export const updatePremiumTrackingSchema = z.object({
  premiumAmount: nullableDecimal(),
  billingFrequency: nullableEnum(BILLING_FREQUENCY_VALUES),
  nextPaymentDueDate: nullableDateOnly(),
  paymentStatus: nullableEnum(PAYMENT_STATUS_VALUES),
  paymentManagementMode: paymentManagementModeSchema,
});
export type UpdatePremiumTrackingInput = z.infer<typeof updatePremiumTrackingSchema>;
