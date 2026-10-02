import { AppError } from "@/services/errors";

export type LeadFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

export function formDataToCreateLeadInput(formData: FormData): Record<string, string> {
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };

  return {
    ...(get("fullName") ? { fullName: get("fullName")! } : {}),
    ...(get("phone") ? { phone: get("phone")! } : {}),
    ...(get("email") ? { email: get("email")! } : {}),
    ...(get("residenceState") ? { residenceState: get("residenceState")! } : {}),
    ...(get("productInterest") ? { productInterest: get("productInterest")! } : {}),
    ...(get("campaignId") ? { campaignId: get("campaignId")! } : {}),
    ...(get("campaignName") ? { campaignName: get("campaignName")! } : {}),
    ...(get("assignedToId") ? { assignedToId: get("assignedToId")! } : {}),
    consentGiven: (formData.get("consentGiven") as string) ?? "",
  };
}

export function toLeadFormState(error: unknown, values: Record<string, string>): LeadFormState {
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
