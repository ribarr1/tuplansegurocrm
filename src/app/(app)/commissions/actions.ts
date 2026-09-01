"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import {
  createCommissionExpectation,
  updateCommissionExpectation,
  cancelCommissionExpectation,
  addCommissionPayment,
} from "@/services/commissions.service";
import {
  formDataToCreateExpectationInput,
  formDataToUpdateExpectationInput,
  formDataToAddPaymentInput,
  toCommissionFormState,
  type CommissionFormState,
} from "./form-helpers";

export type { CommissionFormState };

export async function createCommissionExpectationAction(
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCreateExpectationInput(formData);

  let created;
  try {
    created = await createCommissionExpectation(actor, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath("/dashboard");
  revalidatePath(`/policies/${created.policyId}`);
  redirect(`/commissions/${created.id}`);
}

export async function updateCommissionExpectationAction(
  id: string,
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdateExpectationInput(formData);

  let updated;
  try {
    updated = await updateCommissionExpectation(actor, id, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath("/dashboard");
  revalidatePath(`/commissions/${id}`);
  revalidatePath(`/policies/${updated.policyId}`);
  redirect(`/commissions/${id}`);
}

// Retorna el error en vez de lanzarlo: invocado "fire and forget" desde
// un Client Component vía useTransition (sin useActionState) — una
// excepción no capturada de un Server Action se sanitiza en producción
// (Next.js reemplaza el mensaje real por uno genérico), así que el
// AppError real nunca llegaría al usuario.
export async function cancelCommissionExpectationAction(id: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const cancelled = await cancelCommissionExpectation(actor, id);
    revalidatePath("/commissions");
    revalidatePath("/dashboard");
    revalidatePath(`/commissions/${id}`);
    revalidatePath(`/policies/${cancelled.policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function addCommissionPaymentAction(
  expectationId: string,
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const actor = await requireSessionUser();
  const values = formDataToAddPaymentInput(formData);

  let updated;
  try {
    updated = await addCommissionPayment(actor, expectationId, values);
  } catch (error) {
    return toCommissionFormState(error, values);
  }

  revalidatePath("/commissions");
  revalidatePath("/dashboard");
  revalidatePath(`/commissions/${expectationId}`);
  revalidatePath(`/policies/${updated.policyId}`);
  redirect(`/commissions/${expectationId}`);
}
