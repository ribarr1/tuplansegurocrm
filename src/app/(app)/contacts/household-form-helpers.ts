import { AppError } from "@/services/errors";

export type HouseholdFormState =
  | {
      success?: true;
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

export type SearchPeopleResult = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
};

export type SearchPeopleState = { results: SearchPeopleResult[]; searched: boolean } | undefined;

// Igual patrón que contacts/form-helpers.ts (Fase 009): traduce
// AppError a un mensaje seguro, separa "campo: mensaje" para
// fieldErrors, y repite lo enviado para no perder el formulario tras
// un error (React 19 limpia los campos no controlados de un <form>
// al terminar una Server Action).
export function toHouseholdFormState(
  error: unknown,
  values: Record<string, string> = {}
): HouseholdFormState {
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

export function formDataToRecord(
  formData: FormData,
  fields: readonly string[]
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of fields) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  return raw;
}
