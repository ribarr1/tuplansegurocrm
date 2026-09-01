"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { generateExpectationForPeriod } from "@/services/commission-rules.service";
import { AppError } from "@/services/errors";

export type GenerateExpectationFormState =
  | { error?: string; message?: string }
  | undefined;

export async function generateExpectationAction(
  policyId: string,
  _prevState: GenerateExpectationFormState,
  formData: FormData
): Promise<GenerateExpectationFormState> {
  const actor = await requireSessionUser();
  const period = String(formData.get("period") ?? "");

  let result;
  try {
    result = await generateExpectationForPeriod(actor, { policyId, period });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  revalidatePath(`/policies/${policyId}`);

  const messages: Record<string, string> = {
    CREATED: "Expectativa de comisión generada.",
    ALREADY_EXISTS: "Ya existía una expectativa para ese período — no se modificó.",
    NO_RULE: "No hay una regla de comisión activa para esta póliza o su producto.",
    SKIPPED: "La regla no aplica a este período (ver detalle en Comisiones).",
  };
  return { message: messages[result.status] ?? "Listo." };
}
