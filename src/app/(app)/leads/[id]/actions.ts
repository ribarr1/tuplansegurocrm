"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import {
  assignLead,
  updateLeadFollowUpStatus,
  markLeadAsProspect,
  closeLead,
  addLeadActivity,
  convertLead,
  updateLeadDetails,
} from "@/services/leads.service";
import type { CloseLeadFormState, UpdateLeadDetailsFormState } from "./form-helpers";
import {
  formDataToCloseLeadInput,
  toCloseLeadFormState,
  formDataToUpdateLeadDetailsInput,
  toUpdateLeadDetailsFormState,
} from "./form-helpers";

type SimpleResult = { error?: string };

export async function assignLeadAction(leadId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await requireSessionUser();
  try {
    await assignLead(actor, leadId, {
      assignedToId: (formData.get("assignedToId") as string) ?? "",
      reassignPendingTask: formData.get("reassignPendingTask") === "on" ? "true" : "false",
    });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function updateFollowUpStatusAction(leadId: string, followUpStatus: string): Promise<SimpleResult> {
  const actor = await requireSessionUser();
  try {
    await updateLeadFollowUpStatus(actor, leadId, { followUpStatus });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function markAsProspectAction(leadId: string): Promise<SimpleResult> {
  const actor = await requireSessionUser();
  try {
    await markLeadAsProspect(actor, leadId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function closeLeadAction(
  leadId: string,
  _prevState: CloseLeadFormState,
  formData: FormData
): Promise<CloseLeadFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCloseLeadInput(formData);
  try {
    await closeLead(actor, leadId, values);
  } catch (error) {
    return toCloseLeadFormState(error, values);
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { success: true };
}

export async function updateLeadDetailsAction(
  leadId: string,
  _prevState: UpdateLeadDetailsFormState,
  formData: FormData
): Promise<UpdateLeadDetailsFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdateLeadDetailsInput(formData);
  try {
    const result = await updateLeadDetails(actor, leadId, values);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { success: true, phoneChanged: result.phoneChanged, personMatches: result.personMatches };
  } catch (error) {
    return toUpdateLeadDetailsFormState(error, values);
  }
}

export async function addLeadActivityAction(leadId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await requireSessionUser();
  try {
    await addLeadActivity(actor, leadId, {
      type: formData.get("type") as string,
      outcome: (formData.get("outcome") as string) || undefined,
      note: (formData.get("note") as string) || undefined,
      nextActionAt: (formData.get("nextActionAt") as string) || undefined,
    });
    revalidatePath(`/leads/${leadId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function convertLeadAction(leadId: string, formData: FormData): Promise<SimpleResult> {
  const actor = await requireSessionUser();

  const personId = (formData.get("personId") as string) || undefined;
  const firstName = (formData.get("firstName") as string) || undefined;
  const lastName = (formData.get("lastName") as string) || undefined;
  const phone = (formData.get("phone") as string) || undefined;
  const email = (formData.get("email") as string) || undefined;

  const productId = formData.get("productId") as string;
  const holderCovered = (formData.get("holderCovered") as string) || "true";
  const policyNumber = (formData.get("policyNumber") as string) || undefined;
  const effectiveDate = (formData.get("effectiveDate") as string) || undefined;
  const premiumAmount = (formData.get("premiumAmount") as string) || undefined;

  try {
    await convertLead(actor, leadId, {
      personId: personId || undefined,
      newPerson: personId ? undefined : { firstName, lastName, phone, email },
      policy: {
        productId,
        holderCovered,
        policyNumber,
        effectiveDate,
        premiumAmount,
      },
    });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
