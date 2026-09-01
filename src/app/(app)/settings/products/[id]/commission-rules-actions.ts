"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createCommissionRule, deactivateCommissionRule } from "@/services/commission-rules.service";
import { AppError } from "@/services/errors";

export type CommissionRuleFormState = { error?: string; success?: true } | undefined;

export async function createCommissionRuleAction(
  productId: string,
  _prevState: CommissionRuleFormState,
  formData: FormData
): Promise<CommissionRuleFormState> {
  const actor = await requireSessionUser();

  try {
    await createCommissionRule(actor, {
      productId,
      method: String(formData.get("method") ?? ""),
      base: String(formData.get("base") ?? ""),
      initialAmount: formData.get("initialAmount") ? String(formData.get("initialAmount")) : undefined,
      initialPercentage: formData.get("initialPercentage")
        ? String(formData.get("initialPercentage"))
        : undefined,
      initialPeriodicity: String(formData.get("initialPeriodicity") ?? ""),
      residualEnabled: formData.get("residualEnabled") === "on" ? "true" : "false",
      residualAmount: formData.get("residualAmount") ? String(formData.get("residualAmount")) : undefined,
      residualPercentage: formData.get("residualPercentage")
        ? String(formData.get("residualPercentage"))
        : undefined,
      residualPeriodicity: formData.get("residualPeriodicity")
        ? String(formData.get("residualPeriodicity"))
        : undefined,
      residualStartYear: formData.get("residualStartYear")
        ? String(formData.get("residualStartYear"))
        : undefined,
    });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  revalidatePath(`/settings/products/${productId}/edit`);
  return { success: true };
}

// Retorna el error en vez de lanzarlo — invocado "fire and forget" vía
// useTransition (DeactivateRuleButton), sin useActionState.
export async function deactivateCommissionRuleAction(
  productId: string,
  ruleId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deactivateCommissionRule(actor, ruleId);
    revalidatePath(`/settings/products/${productId}/edit`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
