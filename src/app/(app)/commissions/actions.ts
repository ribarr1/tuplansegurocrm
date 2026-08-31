"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import {
  createCommissionExpectation,
  updateCommissionExpectation,
  cancelCommissionExpectation,
  addCommissionPayment,
} from "@/services/commissions.service";
import {
  formDataToCreateExpectationInput,
  formDataToUpdateExpectationInput,
  formDataToAddPaymentInput,
  toCommissionFormState,
  type CommissionFormState,
} from "./form-helpers";

export type { CommissionFormState };

export async function createCommissionExpectationAction(
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCreateExpectationInput(formData);

  let created;
  try {
    created = await createCommissionExpectation(actor, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath(`/policies/${created.policyId}`);
  redirect(`/commissions/${created.id}`);
}

export async function updateCommissionExpectationAction(
  id: string,
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdateExpectationInput(formData);

  let updated;
  try {
    updated = await updateCommissionExpectation(actor, id, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath(`/commissions/${id}`);
  revalidatePath(`/policies/${updated.policyId}`);
  redirect(`/commissions/${id}`);
}

export async function cancelCommissionExpectationAction(id: string) {
  const actor = await requireSessionUser();
  const cancelled = await cancelCommissionExpectation(actor, id);
  revalidatePath("/commissions");
  revalidatePath(`/commissions/${id}`);
  revalidatePath(`/policies/${cancelled.policyId}`);
}

export async function addCommissionPaymentAction(
  expectationId: string,
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToAddPaymentInput(formData);

  let updated;
  try {
    updated = await addCommissionPayment(actor, expectationId, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath(`/commissions/${expectationId}`);
  revalidatePath(`/policies/${updated.policyId}`);
  redirect(`/commissions/${expectationId}`);
}
