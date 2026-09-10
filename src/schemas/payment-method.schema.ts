import { z } from "zod";
import { US_STATE_CODES } from "@/lib/us-states";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Métodos de pago cifrados por cliente.
//
// PROHIBIDO por diseño: no existe NINGÚN campo para CVV/CVC/CID, PIN, ni
// track data — nunca se agregó la columna, nunca se valida "por si
// alguien lo manda". Si el número de tarjeta/cuenta que llega parece
// contener esos datos pegados (ej. copiar/pegar accidental de "4111...
// 123" con el CVV incluido), la validación de longitud ya lo rechaza
// (ver cardNumberSchema/accountNumberSchema abajo).
// ---------------------------------------------------------------------------

export const personIdSchema = z.uuid("Identificador de persona inválido.");
export const paymentMethodIdSchema = z.uuid("Identificador de método de pago inválido.");

export const PAYMENT_METHOD_TYPE_VALUES = ["CREDIT_CARD", "DEBIT_CARD", "BANK_ACCOUNT"] as const;
export const CARD_BRAND_VALUES = ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "OTHER"] as const;
export const BANK_ACCOUNT_TYPE_VALUES = ["CHECKING", "SAVINGS"] as const;
export const PAYMENT_CONSENT_USE_VALUES = ["AUTOPAY", "PAYMENT_ASSISTANCE", "BOTH"] as const;
export const PAYMENT_METHOD_FIELD_VALUES = ["cardNumber", "routingNumber", "accountNumber"] as const;
export const paymentMethodFieldSchema = z.enum(PAYMENT_METHOD_FIELD_VALUES);

const currentYear = new Date().getUTCFullYear();

// Solo dígitos, 12–19 (rango real de PAN de tarjeta) — nunca acepta
// espacios/guiones silenciosamente reinterpretados como parte del
// número real (se limpian ANTES de validar, nunca se guardan con
// separadores).
const cardNumberSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{12,19}$/, "Número de tarjeta inválido."));

// Routing number ABA: exactamente 9 dígitos.
const routingNumberSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{9}$/, "El routing number debe tener exactamente 9 dígitos."));

// Número de cuenta: solo dígitos, longitud real variable entre bancos.
const accountNumberSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{4,17}$/, "Número de cuenta inválido."));

// Sanitiza el comentario — nunca se persiste HTML/script sin escapar,
// aunque este campo NUNCA se renderiza como HTML en la UI (defensa en
// profundidad, ver payment-methods.service.ts).
function sanitizeComment(v: string): string {
  return v.replace(/<[^>]*>/g, "").trim();
}

const commentSchema = z
  .string()
  .max(1000, "El comentario no puede superar 1,000 caracteres.")
  .transform(sanitizeComment)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const billingAddressSchema = {
  billingAddressLine1: z.string().trim().max(200).optional(),
  billingAddressLine2: z.string().trim().max(200).optional(),
  billingCity: z.string().trim().max(100).optional(),
  billingState: z.enum(US_STATE_CODES).optional(),
  billingZipCode: z.string().trim().max(10).optional(),
};

const cardFieldsSchema = {
  cardholderName: z.string().trim().min(1, "El nombre impreso es obligatorio.").max(200),
  cardNumber: cardNumberSchema,
  cardExpMonth: z.coerce.number().int().min(1).max(12),
  cardExpYear: z.coerce.number().int().min(currentYear).max(currentYear + 30),
  cardBrand: z.enum(CARD_BRAND_VALUES),
};

const bankFieldsSchema = {
  bankAccountHolderName: z.string().trim().min(1, "El titular de la cuenta es obligatorio.").max(200),
  bankName: z.string().trim().min(1, "El banco es obligatorio.").max(200),
  routingNumber: routingNumberSchema,
  accountNumber: accountNumberSchema,
  bankAccountType: z.enum(BANK_ACCOUNT_TYPE_VALUES),
};

// Discriminated union por `type` — nunca acepta campos de tarjeta en un
// registro BANK_ACCOUNT ni viceversa (evita un formulario que mande
// "cardNumber" para una cuenta bancaria por error).
export const createPaymentMethodSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CREDIT_CARD"),
    personId: personIdSchema,
    policyId: z.uuid("Selecciona una póliza válida.").optional(),
    isDefault: z.boolean().default(false),
    autopay: z.boolean().default(false),
    comment: commentSchema,
    consentGiven: z.boolean().default(false),
    consentUse: z.enum(PAYMENT_CONSENT_USE_VALUES).optional(),
    ...cardFieldsSchema,
    ...billingAddressSchema,
  }),
  z.object({
    type: z.literal("DEBIT_CARD"),
    personId: personIdSchema,
    policyId: z.uuid("Selecciona una póliza válida.").optional(),
    isDefault: z.boolean().default(false),
    autopay: z.boolean().default(false),
    comment: commentSchema,
    consentGiven: z.boolean().default(false),
    consentUse: z.enum(PAYMENT_CONSENT_USE_VALUES).optional(),
    ...cardFieldsSchema,
    ...billingAddressSchema,
  }),
  z.object({
    type: z.literal("BANK_ACCOUNT"),
    personId: personIdSchema,
    policyId: z.uuid("Selecciona una póliza válida.").optional(),
    isDefault: z.boolean().default(false),
    autopay: z.boolean().default(false),
    comment: commentSchema,
    consentGiven: z.boolean().default(false),
    consentUse: z.enum(PAYMENT_CONSENT_USE_VALUES).optional(),
    ...bankFieldsSchema,
    ...billingAddressSchema,
  }),
]);
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

// Edición SEGURA (ver CORRECCIÓN §7): nunca acepta un número de
// tarjeta/cuenta parcial — para cambiarlo hay que reautenticarse y
// reemplazarlo COMPLETO (ver replacePaymentMethodNumberSchema). Este
// schema solo cubre los campos "seguros" (metadata, nunca el secreto).
export const updatePaymentMethodSchema = z.object({
  cardholderName: z.string().trim().min(1).max(200).optional(),
  cardExpMonth: z.coerce.number().int().min(1).max(12).optional(),
  cardExpYear: z.coerce.number().int().min(currentYear).max(currentYear + 30).optional(),
  cardBrand: z.enum(CARD_BRAND_VALUES).optional(),
  bankAccountHolderName: z.string().trim().min(1).max(200).optional(),
  bankName: z.string().trim().min(1).max(200).optional(),
  bankAccountType: z.enum(BANK_ACCOUNT_TYPE_VALUES).optional(),
  autopay: z.boolean().optional(),
  comment: commentSchema,
  policyId: z
    .string()
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), z.uuid()]))
    .optional(),
  ...billingAddressSchema,
});
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

// Reemplazo COMPLETO del número — nunca parcial, siempre exige
// reautenticación (ver payment-methods.service.ts::replaceSecretField).
export const replacePaymentMethodSecretSchema = z.object({
  password: z.string().min(1, "Confirma tu contraseña."),
  field: paymentMethodFieldSchema,
  value: z.string().min(1, "El valor es obligatorio."),
});
export type ReplacePaymentMethodSecretInput = z.infer<typeof replacePaymentMethodSecretSchema>;

export const setDefaultPaymentMethodSchema = z.object({
  personId: personIdSchema,
  paymentMethodId: paymentMethodIdSchema,
});
export type SetDefaultPaymentMethodInput = z.infer<typeof setDefaultPaymentMethodSchema>;

// CORRECCIÓN — revelado de métodos de pago: UNA sola reautenticación
// revela el CONJUNTO COMPLETO de datos del método (nunca campo por
// campo — eso obligaba a reautenticarse varias veces para poder
// completar un pago en el portal de la aseguradora, ej. tarjeta +
// vencimiento, o routing + número de cuenta). Ver
// payment-methods.service.ts::revealPaymentMethodFull.
export const revealPaymentMethodFullSchema = z.object({
  password: z.string().min(1, "Confirma tu contraseña."),
  reason: z.string().trim().min(3, "Escribe un motivo breve.").max(300),
  policyId: z.uuid("Selecciona una póliza válida.").optional(),
});
export type RevealPaymentMethodFullInput = z.infer<typeof revealPaymentMethodFullSchema>;

// Campos que la UI permite copiar individualmente UNA VEZ ya revelado
// el conjunto completo — solo se usa para auditar QUÉ se copió (nunca
// el valor). Superconjunto de tarjeta+cuenta bancaria: cada tipo de
// método solo ofrece los campos que le aplican, pero el enum es
// compartido para no duplicar la validación.
export const PAYMENT_METHOD_COPY_FIELD_VALUES = [
  "cardholderName",
  "cardNumber",
  "cardExpiry",
  "bankAccountHolderName",
  "bankName",
  "routingNumber",
  "accountNumber",
  "billingAddress",
  "comment",
] as const;
export const copyPaymentMethodFieldSchema = z.enum(PAYMENT_METHOD_COPY_FIELD_VALUES);

export const revokePaymentMethodSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
export type RevokePaymentMethodInput = z.infer<typeof revokePaymentMethodSchema>;
