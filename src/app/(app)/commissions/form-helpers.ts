import { AppError } from "@/services/errors";

export type CommissionFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

const CREATE_FIELDS = ["policyId", "period", "expectedAmount", "agentId"] as const;

export function formDataToCreateExpectationInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of CREATE_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }
  return raw;
}

// agentId usa formData.has (no formData.get) porque un <select> vacío
// debe traducirse a "desasignar" (null explícito), no a "no tocar" —
// misma técnica de 3 estados que Task.assignedToId (ver task.schema.ts).
// expectedAmount/period sí usan formData.get: si vienen vacíos en un
// formulario de edición completo, es un error de captura, no "no tocar".
const UPDATE_SCALAR_FIELDS = ["expectedAmount", "period"] as const;

export function formDataToUpdateExpectationInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of UPDATE_SCALAR_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }
  if (formData.has("agentId")) {
    raw.agentId = String(formData.get("agentId") ?? "");
  }
  return raw;
}

const PAYMENT_FIELDS = ["type", "amount", "receivedAt", "externalReference", "notes"] as const;

export function formDataToAddPaymentInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of PAYMENT_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }
  return raw;
}

export function toCommissionFormState(
  error: unknown,
  values: Record<string, string>
): CommissionFormState {
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
