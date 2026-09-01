import { AppError } from "@/services/errors";

export type PolicyFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      // Repite lo que el usuario envió (mismo mecanismo que
      // contacts/form-helpers.ts) — solo campos escalares; las
      // casillas de miembros cubiertos no se repueblan tras un error
      // en esta primera versión (simplificación documentada en
      // docs/DECISIONS.md).
      values?: Record<string, string>;
      success?: true;
    }
  | undefined;

const POLICY_SCALAR_FIELDS = [
  "holderId",
  "productId",
  "holderCovered",
  "policyNumber",
  "status",
  "effectiveDate",
  "terminationDate",
  "premiumAmount",
  "billingFrequency",
  "nextPaymentDueDate",
  "paymentStatus",
  "operationType",
  "processedById",
  "healthCoverageSource",
] as const;

const CHECKBOX_FIELDS = ["autopay", "needsPaymentAssistance"] as const;

// Convierte FormData del formulario de creación a un objeto plano que
// createPolicySchema (policy.schema.ts) puede validar. Los miembros
// cubiertos se arman a partir de una lista de ids candidatos (hidden
// input) + un checkbox/select por candidato (member_<id> / role_<id>)
// — el servicio vuelve a validar cada uno, esto es solo transporte.
export function formDataToCreatePolicyInput(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  for (const key of POLICY_SCALAR_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  for (const key of CHECKBOX_FIELDS) {
    raw[key] = formData.get(key) === "on" ? "true" : "false";
  }

  const candidateIds = String(formData.get("candidatePersonIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const coveredMembers = candidateIds
    .filter((id) => formData.get(`member_${id}`) === "on")
    .map((id) => ({ personId: id, role: String(formData.get(`role_${id}`) ?? "OTHER") }));

  raw.coveredMembers = coveredMembers;
  return raw;
}

const POLICY_UPDATE_FIELDS = [
  "productId",
  "policyNumber",
  "status",
  "effectiveDate",
  "terminationDate",
  "premiumAmount",
  "billingFrequency",
  "nextPaymentDueDate",
  "paymentStatus",
  "operationType",
  "processedById",
  "healthCoverageSource",
] as const;

export function formDataToUpdatePolicyInput(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of POLICY_UPDATE_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim() !== "") {
      raw[key] = value;
    }
  }
  for (const key of CHECKBOX_FIELDS) {
    raw[key] = formData.get(key) === "on" ? "true" : "false";
  }
  return raw;
}

// Traduce AppError a un mensaje seguro para el formulario — mismo
// patrón que contacts/form-helpers.ts::toFormState.
export function toPolicyFormState(
  error: unknown,
  values: Record<string, string>
): PolicyFormState {
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
