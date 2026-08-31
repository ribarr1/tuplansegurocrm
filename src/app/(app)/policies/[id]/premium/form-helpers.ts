import { AppError } from "@/services/errors";

export type PremiumFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

// premiumAmount/billingFrequency/nextPaymentDueDate/paymentStatus son
// nullable — usan formData.has (no formData.get) para distinguir "no
// tocar" de "borrar explícitamente" (mismo patrón de 3 estados que
// health/form-helpers.ts). autopay/needsPaymentAssistance no son
// nullable: siempre se envían como "true"/"false" según el checkbox,
// nunca se omiten.
const NULLABLE_FIELDS = [
  "premiumAmount",
  "billingFrequency",
  "nextPaymentDueDate",
  "paymentStatus",
] as const;

export function formDataToUpdatePremiumInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const field of NULLABLE_FIELDS) {
    if (formData.has(field)) {
      raw[field] = String(formData.get(field) ?? "");
    }
  }
  raw.autopay = formData.get("autopay") === "on" ? "true" : "false";
  raw.needsPaymentAssistance = formData.get("needsPaymentAssistance") === "on" ? "true" : "false";
  return raw;
}

export function toPremiumFormState(error: unknown, values: Record<string, string>): PremiumFormState {
  if (error instanceof AppError) {
    if (error.code === "VALIDATION_ERROR") {
      const separatorIndex = error.message.indexOf(": ");
      if (separatorIndex > 0) {
        const field = error.message.slice(0, separatorIndex);
        const message = error.message.slice(separatorIndex + 2);
        return { fieldErrors: { [field]: message }, values };
      }
      return { error: error.message, values };
    }
    return { error: error.message, values };
  }
  return { error: "Ocurrió un error inesperado. Intenta de nuevo.", values };
}
