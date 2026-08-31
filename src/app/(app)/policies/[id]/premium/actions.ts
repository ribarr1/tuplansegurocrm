"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import {
  updatePremiumTracking,
  markPaymentCurrent,
  markPaymentDue,
  markPaymentPastDue,
} from "@/services/premiums.service";
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

  revalidatePath("/premiums");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${policyId}`);
  redirect(`/policies/${policyId}`);
}

export async function markPaymentCurrentAction(policyId: string) {
  const actor = await requireSessionUser();
  await markPaymentCurrent(actor, policyId);
  revalidatePath("/premiums");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${policyId}`);
}

export async function markPaymentDueAction(policyId: string) {
  const actor = await requireSessionUser();
  await markPaymentDue(actor, policyId);
  revalidatePath("/premiums");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${policyId}`);
}

export async function markPaymentPastDueAction(policyId: string) {
  const actor = await requireSessionUser();
  await markPaymentPastDue(actor, policyId);
  revalidatePath("/premiums");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${policyId}`);
}
