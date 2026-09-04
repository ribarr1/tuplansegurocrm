"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createAgentLicense, updateAgentLicense } from "@/services/agent-licenses.service";
import { AppError } from "@/services/errors";

export type LicenseFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function createAgentLicenseAction(
  userId: string,
  _prevState: LicenseFormState,
  formData: FormData
): Promise<LicenseFormState> {
  const actor = await requireSessionUser();
  try {
    await createAgentLicense(actor, {
      userId,
      state: String(formData.get("state") ?? ""),
      status: String(formData.get("status") ?? "ACTIVE"),
      licenseNumber: String(formData.get("licenseNumber") ?? ""),
      effectiveDate: String(formData.get("effectiveDate") ?? "") || undefined,
      expirationDate: String(formData.get("expirationDate") ?? "") || undefined,
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
  revalidatePath(`/settings/users/${userId}/licenses`);
  return undefined;
}

export async function setAgentLicenseStatusAction(
  licenseId: string,
  userId: string,
  status: "ACTIVE" | "INACTIVE"
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await updateAgentLicense(actor, licenseId, { status });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/licenses`);
  return {};
}
