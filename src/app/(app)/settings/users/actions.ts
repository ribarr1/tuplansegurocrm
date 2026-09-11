"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createUser, setUserActive, setUserIsAgent, resetUserPassword } from "@/services/users.service";
import { resendInvitation, revokeInvitation } from "@/services/user-invitations.service";
import { AppError } from "@/services/errors";

// CORRECCIÓN (activación de usuarios): ya no existe "temporaryPassword"
// — el ADMIN nunca ve ni define una contraseña, se envía una
// invitación de un solo uso por correo.
export type CreateUserFormState =
  | { error: string }
  | { success: true; email: string }
  | undefined;

export async function createUserAction(
  _prevState: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  const actor = await requireSessionUser();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");
  const isAgent = formData.get("isAgent") === "on";

  try {
    const { user } = await createUser(actor, { name, email, role, isAgent });
    revalidatePath("/settings/users");
    return { success: true, email: user.email };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

// CORRECCIÓN (activación de usuarios) — ADMIN-only (reforzado también
// server-side dentro de resendInvitation, nunca solo aquí).
export async function resendInvitationAction(userId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await resendInvitation(actor, { userId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/settings/users");
  return {};
}

// PREPRODUCCIÓN — ADMIN-only (reforzado también server-side dentro de
// revokeInvitation, nunca solo aquí).
export async function revokeInvitationAction(userId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await revokeInvitation(actor, { userId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/settings/users");
  return {};
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

export async function toggleUserIsAgentAction(
  id: string,
  isAgent: boolean
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setUserIsAgent(actor, { id, isAgent });
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
