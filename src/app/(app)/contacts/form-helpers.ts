import { AppError } from "@/services/errors";

export type PersonFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      // Repite lo que el usuario envió. React 19 limpia los campos no
      // controlados de un <form> tras ejecutar una Server Action —
      // sin esto, un error de validación borraría lo ya escrito.
      values?: Record<string, string>;
    }
  | undefined;

const PERSON_FORM_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "secondLastName",
  "preferredName",
  "dateOfBirth",
  "sex",
  "email",
  "phone",
  "contactStatus",
  "source",
  "assignedAgentId",
] as const;

// Convierte FormData a un objeto plano, sin inventar campos que no
// existan en Person. Campos vacíos se omiten (quedan "no enviados",
// no strings vacíos) para no chocar con los .optional() de Zod.
export function formDataToPersonInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of PERSON_FORM_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  return raw;
}

// Traduce AppError a un mensaje seguro para el formulario. Nunca deja
// pasar detalles internos (Prisma, stack traces). VALIDATION_ERROR
// llega como "campo: mensaje" (ver services/errors.ts) — se separa
// para poder mostrar el error junto al campo correspondiente.
export function toFormState(error: unknown, values: Record<string, string>): PersonFormState {
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
