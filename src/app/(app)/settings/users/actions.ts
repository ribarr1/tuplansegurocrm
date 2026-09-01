"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createUser, setUserActive } from "@/services/users.service";
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
