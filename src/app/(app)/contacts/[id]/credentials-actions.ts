"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  createClientPortalCredential,
  deactivateClientPortalCredential,
  revealClientPortalCredentialField,
  recordClientPortalCredentialCopy,
} from "@/services/client-portal-credentials.service";
import { AppError } from "@/services/errors";

// Vault de credenciales de portal del CLIENTE — Fase 025 (Parte J). Ver
// sensitive-identity-actions.ts (Fase 021) para el mismo principio:
// reveal*Action SOLO retorna el valor completo al cliente que lo
// invocó explícitamente, nunca precargado ni cacheado.

export type CredentialFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function createClientPortalCredentialAction(
  personId: string,
  _prevState: CredentialFormState,
  formData: FormData
): Promise<CredentialFormState> {
  const actor = await requireSessionUser();
  try {
    await createClientPortalCredential(actor, {
      personId,
      carrierId: String(formData.get("carrierId") ?? "") || undefined,
      portalType: String(formData.get("portalType") ?? ""),
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
  revalidatePath(`/contacts/${personId}`);
  return undefined;
}

export async function deactivateClientPortalCredentialAction(
  credentialId: string,
  personId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deactivateClientPortalCredential(actor, credentialId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return {};
}

export async function revealClientPortalCredentialAction(
  credentialId: string,
  field: "username" | "password"
): Promise<{ value?: string; error?: string }> {
  const actor = await requireSessionUser();
  try {
    return { value: await revealClientPortalCredentialField(actor, credentialId, field) };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function copyClientPortalCredentialAction(
  credentialId: string,
  field: "username" | "password"
): Promise<void> {
  const actor = await requireSessionUser();
  try {
    await recordClientPortalCredentialCopy(actor, credentialId, field);
  } catch {
    // Nunca se propaga el error al cliente — la copia al portapapeles
    // ya ocurrió; si el audit falla no debe romper la UX (ver
    // revealable-credential-field.tsx).
  }
}
