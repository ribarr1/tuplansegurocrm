"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
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

export async function toggleCarrierActiveAction(id: string, isActive: boolean) {
  const actor = await requireSessionUser();
  await setCarrierActive(actor, id, isActive);
  revalidatePath("/settings/carriers");
}
