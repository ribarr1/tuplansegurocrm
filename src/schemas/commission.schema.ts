import { z } from "zod";
import { optionalSearchFilter, optionalUuidFilter, optionalEnumFilter } from "@/schemas/common";

// Valores reales de los enums de comisiones (prisma/schema.prisma),
// duplicados aquí como literales por la misma razón que en el resto de
// schemas — status solo tiene ACTIVE/CANCELLED: PENDING/PARTIAL/PAID/
// OVERPAID son estados DERIVADOS (ver computeCommissionStatus en
// commissions.service.ts), nunca se guardan en la base de datos.
export const COMMISSION_EXPECTATION_STATUS_VALUES = ["ACTIVE", "CANCELLED"] as const;
export const COMMISSION_PAYMENT_TYPE_VALUES = ["PAYMENT", "CHARGEBACK", "ADJUSTMENT"] as const;

export const commissionExpectationIdSchema = z.uuid("Identificador de comisión inválido.");

// Monto en dólares con hasta 2 decimales, siempre como string — igual
// convención que premiumAmount/taxCreditAmount en fases anteriores:
// nunca se usa Number/parseFloat para lógica financiera.
const magnitudeDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 1250.00).");

// Solo ADJUSTMENT puede llevar signo explícito desde el formulario — ver
// §addCommissionPaymentSchema. PAYMENT/CHARGEBACK siempre entran como
// magnitud positiva; el servicio decide el signo final almacenado.
const signedDecimalSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 1250.00 o -1250.00).");

// El <input type="month"> del navegador entrega "2026-08" — se normaliza
// server-side al primer día de ese mes (convención de CommissionExpectation.period,
// ver prisma/schema.prisma). Nunca se acepta una fecha arbitraria.
export const periodSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Selecciona un período (mes y año) válido.")
  .transform((value, ctx) => {
    const [year, month] = value.split("-").map(Number);
    if (month < 1 || month > 12) {
      ctx.addIssue({ code: "custom", message: "Selecciona un período (mes y año) válido." });
      return z.NEVER;
    }
    return new Date(Date.UTC(year, month - 1, 1));
  });

function nullableAgentId() {
  return z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), z.uuid("Selecciona un agente válido.")]))
    .optional();
}

// Usado por getCommissionTotalsForPeriod (commissions.service.ts,
// Fase 019) — a diferencia de listCommissionExpectationsQuerySchema,
// period es requerido: un total agregado siempre necesita saber de
// qué mes, nunca "todos los períodos".
export const commissionTotalsQuerySchema = z.object({ period: periodSchema });

export const listCommissionExpectationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchFilter(),
  period: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Período inválido.")
      .optional()
  ),
  agentId: optionalUuidFilter(),
  carrierId: optionalUuidFilter(),
  status: optionalEnumFilter(COMMISSION_EXPECTATION_STATUS_VALUES),
});
export type ListCommissionExpectationsQuery = z.infer<typeof listCommissionExpectationsQuerySchema>;

// Solo ADMIN crea (ver commissions.service.ts) — policyId nunca es
// editable después de creada: es la identidad de la expectativa.
export const createCommissionExpectationSchema = z.object({
  policyId: z.uuid("Selecciona una póliza válida."),
  period: periodSchema,
  expectedAmount: magnitudeDecimalSchema,
  agentId: z.uuid("Selecciona un agente válido.").optional(),
});
export type CreateCommissionExpectationInput = z.infer<typeof createCommissionExpectationSchema>;

// period solo se acepta si la expectativa todavía no tiene pagos
// (regla de negocio, aplicada en el servicio, no aquí). expectedAmount
// sí puede editarse aunque ya existan pagos: es una corrección legítima
// de la expectativa, los movimientos ya registrados nunca se tocan.
export const updateCommissionExpectationSchema = z.object({
  expectedAmount: magnitudeDecimalSchema.optional(),
  agentId: nullableAgentId(),
  period: periodSchema.optional(),
  // Fase 019.7 (hallazgo #14.5) — motivo opcional del override manual,
  // solo tiene efecto cuando expectedAmount cambia respecto al valor
  // calculado por la regla.
  overrideReason: z.string().trim().max(500).optional(),
});
export type UpdateCommissionExpectationInput = z.infer<typeof updateCommissionExpectationSchema>;

// datetime-local del navegador, misma convención que Task.dueAt en
// task.schema.ts — requerido porque CommissionPayment.receivedAt no es
// nullable en el schema.
const receivedAtSchema = z.coerce.date({ error: "Selecciona una fecha válida." });

// El signo final de amount se resuelve en el servicio, no aquí, porque
// depende de "type" (regla cruzada entre campos) — ver
// assertAndNormalizePaymentAmount en commissions.service.ts:
//   PAYMENT: el usuario escribe un monto positivo, se guarda positivo.
//   CHARGEBACK: el usuario escribe un monto positivo "amigable"
//     (ej. "125.50"), el servicio lo guarda como negativo.
//   ADJUSTMENT: el usuario puede escribir signo explícito ("-50.00"),
//     se guarda tal cual, pero nunca puede ser 0.
export const addCommissionPaymentSchema = z.object({
  type: z.enum(COMMISSION_PAYMENT_TYPE_VALUES, "Selecciona un tipo de movimiento válido."),
  amount: signedDecimalSchema,
  receivedAt: receivedAtSchema,
  externalReference: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type AddCommissionPaymentInput = z.infer<typeof addCommissionPaymentSchema>;
