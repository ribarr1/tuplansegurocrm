"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { uploadPolicyDocument, deletePolicyDocument } from "@/services/policy-documents.service";
import { AppError } from "@/services/errors";

export type DocumentFormState = { error?: string; success?: true } | undefined;

export async function uploadPolicyDocumentAction(
  policyId: string,
  _prevState: DocumentFormState,
  formData: FormData
): Promise<DocumentFormState> {
  const actor = await requireSessionUser();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "file: Selecciona un archivo." };
  }

  try {
    await uploadPolicyDocument(
      actor,
      {
        policyId,
        type: formData.get("type"),
        description: formData.get("description") || undefined,
      },
      file
    );
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  revalidatePath(`/policies/${policyId}`);
  return { success: true };
}

// Retorna el error en vez de lanzarlo — mismo motivo que
// cancelCommissionExpectationAction (commissions/actions.ts): invocado
// "fire and forget" vía useTransition, sin useActionState.
export async function deletePolicyDocumentAction(documentId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const { policyId } = await deletePolicyDocument(actor, documentId);
    revalidatePath(`/policies/${policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
