import { AppError } from "@/services/errors";

export type CloseLeadFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
      success?: boolean;
    }
  | undefined;

export function formDataToCloseLeadInput(formData: FormData): Record<string, string> {
  const closeReasonDetail = formData.get("closeReasonDetail");
  return {
    closeReason: (formData.get("closeReason") as string) ?? "",
    ...(typeof closeReasonDetail === "string" && closeReasonDetail.trim() !== ""
      ? { closeReasonDetail }
      : {}),
  };
}

export function toCloseLeadFormState(error: unknown, values: Record<string, string>): CloseLeadFormState {
  if (error instanceof AppError) {
    if (error.code === "VALIDATION_ERROR") {
      const separatorIndex = error.message.indexOf(": ");
      if (separatorIndex > 0) {
        const field = error.message.slice(0, separatorIndex);
        const message = error.message.slice(separatorIndex + 2);
        return { fieldErrors: { [field]: message }, values };
      }
    }
    return { error: error.message, values };
  }
  return { error: "Ocurrió un error inesperado. Intenta de nuevo.", values };
}

export type UpdateLeadDetailsFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
      success?: boolean;
      phoneChanged?: boolean;
      personMatches?: { id: string; firstName: string; lastName: string }[];
    }
  | undefined;

export function formDataToUpdateLeadDetailsInput(formData: FormData): Record<string, string> {
  const get = (key: string) => (formData.get(key) as string) ?? "";
  return {
    fullName: get("fullName"),
    phone: get("phone"),
    email: get("email"),
    residenceState: get("residenceState"),
    productInterest: get("productInterest"),
  };
}

export function toUpdateLeadDetailsFormState(
  error: unknown,
  values: Record<string, string>
): UpdateLeadDetailsFormState {
  if (error instanceof AppError) {
    if (error.code === "VALIDATION_ERROR") {
      const separatorIndex = error.message.indexOf(": ");
      if (separatorIndex > 0) {
        const field = error.message.slice(0, separatorIndex);
        const message = error.message.slice(separatorIndex + 2);
        return { fieldErrors: { [field]: message }, values };
      }
    }
    return { error: error.message, values };
  }
  return { error: "Ocurrió un error inesperado. Intenta de nuevo.", values };
}
