"use server";

import { headers } from "next/headers";
import { activateAccount } from "@/services/user-invitations.service";
import { AppError } from "@/services/errors";

export type ActivateAccountFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

export async function activateAccountAction(
  userId: string,
  token: string,
  _prevState: ActivateAccountFormState,
  formData: FormData
): Promise<ActivateAccountFormState> {
  try {
    await activateAccount(
      {
        userId,
        token,
        newPassword: String(formData.get("newPassword") ?? ""),
        confirmPassword: String(formData.get("confirmPassword") ?? ""),
      },
      await headers()
    );
  } catch (error) {
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
  return { success: true };
}
