import { AppError } from "@/services/errors";

export type TaskFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

const CREATE_FIELDS = [
  "title",
  "description",
  "priority",
  "dueAt",
  "personId",
  "policyId",
  "assignedToId",
] as const;

export function formDataToCreateTaskInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of CREATE_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  return raw;
}

const UPDATE_FIELDS = ["title", "description", "status", "priority", "dueAt", "assignedToId"] as const;

// Solo incluye una clave si el campo realmente vino en el <form> — así
// "Responsable" ausente del formulario de un AGENT (que nunca puede
// reasignar) se traduce en "no tocar", no en "desasignar". Mismo
// mecanismo que health/form-helpers.ts.
export function formDataToUpdateTaskInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of UPDATE_FIELDS) {
    if (formData.has(key)) {
      raw[key] = String(formData.get(key) ?? "");
    }
  }
  return raw;
}

export function toTaskFormState(error: unknown, values: Record<string, string>): TaskFormState {
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
