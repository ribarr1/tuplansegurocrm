import { AppError } from "@/services/errors";

export type CarrierFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

export function formDataToCarrierInput(formData: FormData): Record<string, string> {
  const name = formData.get("name");
  return {
    ...(typeof name === "string" && name.trim() !== "" ? { name } : {}),
    isActive: formData.get("isActive") === "on" ? "true" : "false",
  };
}

export function toCarrierFormState(error: unknown, values: Record<string, string>): CarrierFormState {
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
