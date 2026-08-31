"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import {
  createHealthPolicyDetail,
  updateHealthPolicyDetail,
} from "@/services/health-policies.service";
import {
  formDataToHealthDetailInput,
  toHealthDetailFormState,
  type HealthDetailFormState,
} from "./form-helpers";

export type { HealthDetailFormState };

export async function createHealthDetailAction(
  policyId: string,
  _prevState: HealthDetailFormState,
  formData: FormData
): Promise<HealthDetailFormState> {
  const actor = await requireSessionUser();
  const values = formDataToHealthDetailInput(formData);

  try {
    await createHealthPolicyDetail(actor, { policyId, ...values });
  } catch (error) {
    return toHealthDetailFormState(error, values);
  }

  revalidatePath(`/policies/${policyId}`);
  redirect(`/policies/${policyId}`);
}

export async function updateHealthDetailAction(
  policyId: string,
  _prevState: HealthDetailFormState,
  formData: FormData
): Promise<HealthDetailFormState> {
  const actor = await requireSessionUser();
  const values = formDataToHealthDetailInput(formData);

  try {
    await updateHealthPolicyDetail(actor, policyId, values);
  } catch (error) {
    return toHealthDetailFormState(error, values);
  }

  revalidatePath(`/policies/${policyId}`);
  redirect(`/policies/${policyId}`);
}
