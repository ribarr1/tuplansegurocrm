"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { createLeadManual } from "@/services/leads.service";
import { formDataToCreateLeadInput, toLeadFormState, type LeadFormState } from "./form-helpers";

export type { LeadFormState };

export async function createLeadAction(
  _prevState: LeadFormState,
  formData: FormData
): Promise<LeadFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCreateLeadInput(formData);

  let result;
  try {
    result = await createLeadManual(actor, values);
  } catch (error) {
    return toLeadFormState(error, values);
  }

  revalidatePath("/leads");
  redirect(`/leads/${result.lead.id}`);
}
