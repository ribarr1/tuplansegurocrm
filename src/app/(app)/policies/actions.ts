"use server";

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { createPolicy, updatePolicy } from "@/services/policies.service";
import {
  formDataToCreatePolicyInput,
  formDataToUpdatePolicyInput,
  toPolicyFormState,
  type PolicyFormState,
} from "./form-helpers";

export type { PolicyFormState };

export async function createPolicyAction(
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const actor = await requireSessionUser();
  const input = formDataToCreatePolicyInput(formData);
  // Solo los campos escalares se repiten al usuario en caso de error —
  // ver PolicyFormState en form-helpers.ts.
  const scalarValues = Object.fromEntries(
    Object.entries(input).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>;

  let created;
  try {
    created = await createPolicy(actor, input);
  } catch (error) {
    return toPolicyFormState(error, scalarValues);
  }

  redirect(`/policies/${created.id}`);
}

export async function updatePolicyAction(
  id: string,
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdatePolicyInput(formData) as Record<string, string>;

  try {
    await updatePolicy(actor, id, values);
  } catch (error) {
    return toPolicyFormState(error, values);
  }

  redirect(`/policies/${id}`);
}
