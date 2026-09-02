"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import {
  updatePremiumTracking,
  markPaymentCurrent,
  markPaymentDue,
  markPaymentPastDue,
} from "@/services/premiums.service";
import { autoGenerateCurrentPeriodExpectation } from "@/services/commission-rules.service";
import {
  formDataToUpdatePremiumInput,
  toPremiumFormState,
  type PremiumFormState,
} from "./form-helpers";

export type { PremiumFormState };

export async function updatePremiumTrackingAction(
  policyId: string,
  _prevState: PremiumFormState,
  formData: FormData
): Promise<PremiumFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdatePremiumInput(formData);

  try {
    await updatePremiumTracking(actor, policyId, values);
  } catch (error) {
    return toPremiumFormState(error, values);
  }

  // Hallazgo #14: si la regla de comisión de esta póliza depende de la
  // prima (PREMIUM_MONTHLY/PREMIUM_ANNUALIZED), cambiarla puede
  // habilitar la expectativa del mes actual — best effort.
  await autoGenerateCurrentPeriodExpectation(policyId, actor);

  revalidatePath("/premiums");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${policyId}`);
  redirect(`/policies/${policyId}`);
}

// Las tres retornan el error en vez de lanzarlo — invocadas "fire and
// forget" vía useTransition (QuickPaymentStatusButtons), sin
// useActionState; una excepción no capturada se sanitiza en producción.
export async function markPaymentCurrentAction(policyId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await markPaymentCurrent(actor, policyId);
    revalidatePath("/premiums");
    revalidatePath("/dashboard");
    revalidatePath(`/policies/${policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function markPaymentDueAction(policyId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await markPaymentDue(actor, policyId);
    revalidatePath("/premiums");
    revalidatePath("/dashboard");
    revalidatePath(`/policies/${policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function markPaymentPastDueAction(policyId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await markPaymentPastDue(actor, policyId);
    revalidatePath("/premiums");
    revalidatePath("/dashboard");
    revalidatePath(`/policies/${policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
