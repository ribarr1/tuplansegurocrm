"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createUser, setUserActive, resetUserPassword } from "@/services/users.service";
import { AppError } from "@/services/errors";

export type CreateUserFormState =
  | { error: string }
  | { success: true; email: string; temporaryPassword: string }
  | undefined;

export async function createUserAction(
  _prevState: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  const actor = await requireSessionUser();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");

  try {
    const { user, temporaryPassword } = await createUser(actor, { name, email, role });
    revalidatePath("/settings/users");
    return { success: true, email: user.email, temporaryPassword };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

// Retorna el mensaje de error en vez de lanzar: un Server Action
// invocado de forma "fire and forget" (useTransition, sin
// useActionState) pierde el mensaje real de AppError en producción —
// Next.js sanitiza las excepciones no capturadas de Server Actions.
export async function toggleUserActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setUserActive(actor, { id, isActive });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/settings/users");
  return {};
}

// Fase 022 (Hallazgo #4 de UAT) — Restablecer contraseña.
export type ResetPasswordFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

export async function resetUserPasswordAction(
  userId: string,
  _prevState: ResetPasswordFormState,
  formData: FormData
): Promise<ResetPasswordFormState> {
  const actor = await requireSessionUser();
  try {
    await resetUserPassword(actor, {
      id: userId,
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });
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
