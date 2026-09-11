"use server";

import { headers } from "next/headers";
import { requireSessionUser } from "@/lib/authorization";
import { changeOwnPassword, requestEmailChange } from "@/services/account-security.service";
import { AppError } from "@/services/errors";

export type AccountSecurityFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

function toFieldErrors(error: unknown): AccountSecurityFormState {
  if (error instanceof AppError) {
    if (error.code === "VALIDATION_ERROR") {
      const sep = error.message.indexOf(": ");
      if (sep > 0) {
        return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
      }
    }
    return { error: error.message };
  }
  return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
}

export async function changeOwnPasswordAction(
  _prevState: AccountSecurityFormState,
  formData: FormData
): Promise<AccountSecurityFormState> {
  const actor = await requireSessionUser();
  try {
    await changeOwnPassword(
      actor,
      {
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword: String(formData.get("newPassword") ?? ""),
        confirmPassword: String(formData.get("confirmPassword") ?? ""),
      },
      await headers()
    );
  } catch (error) {
    return toFieldErrors(error);
  }
  return { success: true };
}

export async function requestEmailChangeAction(
  _prevState: AccountSecurityFormState,
  formData: FormData
): Promise<AccountSecurityFormState> {
  const actor = await requireSessionUser();
  try {
    await requestEmailChange(
      actor,
      {
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newEmail: String(formData.get("newEmail") ?? ""),
      },
      await headers()
    );
  } catch (error) {
    return toFieldErrors(error);
  }
  return { success: true };
}
