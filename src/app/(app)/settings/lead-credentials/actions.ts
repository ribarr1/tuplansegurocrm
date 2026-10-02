"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import {
  createLeadCredential,
  revokeLeadCredential,
  setGoogleConnectorSecrets,
  setMetaConnectorSecrets,
  setCustomFieldMapping,
} from "@/services/lead-credentials.service";
import { retryWebhookEvent } from "@/services/lead-webhook-events.service";

export type CreateCredentialState =
  | { error?: string; fieldErrors?: Record<string, string>; created?: { label: string; authorizationHeaderValue: string } }
  | undefined;

export async function createLeadCredentialAction(
  _prevState: CreateCredentialState,
  formData: FormData
): Promise<CreateCredentialState> {
  const actor = await requireSessionUser();
  const values = {
    label: (formData.get("label") as string) ?? "",
    source: (formData.get("source") as string) ?? "",
  };

  try {
    const created = await createLeadCredential(actor, values);
    revalidatePath("/settings/lead-credentials");
    return { created: { label: created.label, authorizationHeaderValue: created.authorizationHeaderValue } };
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "VALIDATION_ERROR") {
        const separatorIndex = error.message.indexOf(": ");
        if (separatorIndex > 0) {
          return {
            fieldErrors: { [error.message.slice(0, separatorIndex)]: error.message.slice(separatorIndex + 2) },
          };
        }
      }
      return { error: error.message };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function revokeLeadCredentialAction(id: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await revokeLeadCredential(actor, id);
    revalidatePath("/settings/lead-credentials");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function setGoogleConnectorSecretsAction(
  credentialId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setGoogleConnectorSecrets(actor, credentialId, {
      verificationKey: (formData.get("verificationKey") as string) ?? "",
    });
    revalidatePath("/settings/lead-credentials");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function setMetaConnectorSecretsAction(
  credentialId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setMetaConnectorSecrets(actor, credentialId, {
      appSecret: (formData.get("appSecret") as string) ?? "",
      pageAccessToken: (formData.get("pageAccessToken") as string) ?? "",
      verifyToken: (formData.get("verifyToken") as string) ?? "",
      pageId: (formData.get("pageId") as string) ?? "",
    });
    revalidatePath("/settings/lead-credentials");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function retryWebhookEventAction(eventId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await retryWebhookEvent(actor, eventId);
    revalidatePath("/settings/lead-credentials");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function setCustomFieldMappingAction(
  credentialId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setCustomFieldMapping(actor, credentialId, {
      residenceStateFieldKey: (formData.get("residenceStateFieldKey") as string) || undefined,
      productInterestFieldKey: (formData.get("productInterestFieldKey") as string) || undefined,
    });
    revalidatePath("/settings/lead-credentials");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
