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
// health/form-helpers.ts). paymentManagementMode no es nullable: es un
// <select> que siempre envía un valor.
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
  raw.paymentManagementMode = String(formData.get("paymentManagementMode") ?? "CLIENT_MANAGED");
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
