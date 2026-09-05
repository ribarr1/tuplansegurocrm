"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  createAgentPortalCredential,
  updateAgentPortalCredential,
  deactivateAgentPortalCredential,
  revealAgentPortalCredentialField,
  recordAgentPortalCredentialCopy,
} from "@/services/agent-portal-credentials.service";
import { AppError } from "@/services/errors";

// Un campo de formulario vacío ("") significa "conservar el valor
// actual" para username/password/notas — NUNCA se envía "" al
// servicio como si fuera un reemplazo real (ver
// credential-vault.schema.ts: username/password exigen min(1), un ""
// explícito produciría un error de validación en vez de "sin
// cambios"). Se omite la clave por completo, igual que el resto de
// updates parciales de la app (ver form-helpers.ts, policies).
function emptyToOmitted(value: FormDataEntryValue | null): string | undefined {
  const str = String(value ?? "");
  return str === "" ? undefined : str;
}

export type CredentialFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function createAgentPortalCredentialAction(
  userId: string,
  _prevState: CredentialFormState,
  formData: FormData
): Promise<CredentialFormState> {
  const actor = await requireSessionUser();
  try {
    await createAgentPortalCredential(actor, {
      userId,
      carrierId: String(formData.get("carrierId") ?? "") || undefined,
      portalName: String(formData.get("portalName") ?? ""),
      portalUrl: String(formData.get("portalUrl") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) {
      const sep = error.message.indexOf(": ");
      if (error.code === "VALIDATION_ERROR" && sep > 0) {
        return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
      }
      return { error: error.message };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/credentials`);
  return undefined;
}

export async function updateAgentPortalCredentialAction(
  credentialId: string,
  userId: string,
  _prevState: CredentialFormState,
  formData: FormData
): Promise<CredentialFormState> {
  const actor = await requireSessionUser();
  try {
    await updateAgentPortalCredential(actor, credentialId, {
      carrierId: String(formData.get("carrierId") ?? ""),
      portalName: String(formData.get("portalName") ?? ""),
      portalUrl: String(formData.get("portalUrl") ?? ""),
      username: emptyToOmitted(formData.get("username")),
      password: emptyToOmitted(formData.get("password")),
    });
  } catch (error) {
    if (error instanceof AppError) {
      const sep = error.message.indexOf(": ");
      if (error.code === "VALIDATION_ERROR" && sep > 0) {
        return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
      }
      return { error: error.message };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/credentials`);
  return undefined;
}

export async function deactivateAgentPortalCredentialAction(
  credentialId: string,
  userId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deactivateAgentPortalCredential(actor, credentialId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/credentials`);
  return {};
}

export async function revealAgentPortalCredentialAction(
  credentialId: string,
  field: "username" | "password"
): Promise<{ value?: string; error?: string }> {
  const actor = await requireSessionUser();
  try {
    return { value: await revealAgentPortalCredentialField(actor, credentialId, field) };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function copyAgentPortalCredentialAction(
  credentialId: string,
  field: "username" | "password"
): Promise<void> {
  const actor = await requireSessionUser();
  try {
    await recordAgentPortalCredentialCopy(actor, credentialId, field);
  } catch {
    // Nunca se propaga — ver credentials-actions.ts (contacts).
  }
}
