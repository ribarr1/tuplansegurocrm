import { AppError } from "@/services/errors";

export type HealthDetailFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string>;
    }
  | undefined;

const HEALTH_DETAIL_FIELDS = [
  "marketplaceApplicationId",
  "marketplaceState",
  "planNameSnapshot",
  "taxCreditAmount",
  "incomeUsed",
  "deductibleIndividual",
  "deductibleFamily",
  "outOfPocketIndividual",
  "outOfPocketFamily",
] as const;

// Solo incluye una clave si el campo realmente existe en el formulario
// enviado (formData.has, no formData.get) — así se distingue "el actor
// no puede ver/editar este campo, no vino en el <form>" (debe quedar
// undefined -> "no tocar") de "el campo vino vacío" (debe quedar ""
// -> null explícito). Ver health-policy.schema.ts.
export function formDataToHealthDetailInput(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const field of HEALTH_DETAIL_FIELDS) {
    if (formData.has(field)) {
      raw[field] = String(formData.get(field) ?? "");
    }
  }
  return raw;
}

export function toHealthDetailFormState(
  error: unknown,
  values: Record<string, string>
): HealthDetailFormState {
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
