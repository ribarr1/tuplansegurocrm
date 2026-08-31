import { AppError } from "@/services/errors";

export type ProductFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

const PRODUCT_FIELDS = ["carrierId", "name", "policyType", "planYear", "externalCode"] as const;

export function formDataToProductInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of PRODUCT_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  raw.isActive = formData.get("isActive") === "on" ? "true" : "false";
  return raw;
}

export function toProductFormState(error: unknown, values: Record<string, string>): ProductFormState {
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
