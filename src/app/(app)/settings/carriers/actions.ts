"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import { createCarrier, updateCarrier, setCarrierActive } from "@/services/carriers.service";
import { formDataToCarrierInput, toCarrierFormState, type CarrierFormState } from "./form-helpers";

export type { CarrierFormState };

export async function createCarrierAction(
  _prevState: CarrierFormState,
  formData: FormData
): Promise<CarrierFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCarrierInput(formData);

  let created;
  try {
    created = await createCarrier(actor, values);
  } catch (error) {
    return toCarrierFormState(error, values);
  }

  revalidatePath("/settings/carriers");
  redirect(`/settings/carriers/${created.id}/edit`);
}

export async function updateCarrierAction(
  id: string,
  _prevState: CarrierFormState,
  formData: FormData
): Promise<CarrierFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCarrierInput(formData);

  try {
    await updateCarrier(actor, id, values);
  } catch (error) {
    return toCarrierFormState(error, values);
  }

  revalidatePath("/settings/carriers");
  redirect("/settings/carriers");
}

// Retorna el error en vez de lanzarlo — invocado "fire and forget" vía
// useTransition, sin useActionState.
export async function toggleCarrierActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setCarrierActive(actor, id, isActive);
    revalidatePath("/settings/carriers");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
