"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { uploadPolicyDocument, deletePolicyDocument } from "@/services/policy-documents.service";
import { AppError } from "@/services/errors";

export type DocumentFormState = { error?: string } | undefined;

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
}

export async function deletePolicyDocumentAction(documentId: string) {
  const actor = await requireSessionUser();
  const { policyId } = await deletePolicyDocument(actor, documentId);
  revalidatePath(`/policies/${policyId}`);
}
