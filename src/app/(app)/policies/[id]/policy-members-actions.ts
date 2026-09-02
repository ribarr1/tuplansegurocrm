"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { addPolicyMember, removePolicyMember, linkPolicyToHousehold } from "@/services/policies.service";
import { autoGenerateCurrentPeriodExpectation } from "@/services/commission-rules.service";
import { AppError } from "@/services/errors";

export type AddPolicyMemberFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

export async function addPolicyMemberAction(
  policyId: string,
  _prevState: AddPolicyMemberFormState,
  formData: FormData
): Promise<AddPolicyMemberFormState> {
  const actor = await requireSessionUser();
  const personId = String(formData.get("personId") ?? "");
  const role = String(formData.get("role") ?? "");

  try {
    await addPolicyMember(actor, policyId, { personId, role });
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

  // Hallazgo #14: si la regla de comisión de esta póliza es PER_MEMBER,
  // agregar un miembro puede habilitar la expectativa del mes actual
  // (nunca recalcula meses ya generados/pagados) — best effort.
  await autoGenerateCurrentPeriodExpectation(policyId, actor);

  revalidatePath(`/policies/${policyId}`);
  return { success: true };
}

// Retorna el error en vez de lanzarlo — invocado "fire and forget" vía
// useTransition, sin useActionState (mismo patrón que el resto de
// botones de una sola acción en la app).
export async function removePolicyMemberAction(
  policyId: string,
  policyMemberId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await removePolicyMember(actor, policyId, policyMemberId);
    revalidatePath(`/policies/${policyId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export type LinkHouseholdFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

// Hallazgo #17 de UAT (Fase 019.8): repara Policy.householdId cuando
// quedó null (ej. el hogar se creó DESPUÉS de la póliza) — nunca
// agrega miembros automáticamente, solo habilita el universo de
// candidatos elegibles para "+ Agregar miembro".
export async function linkPolicyToHouseholdAction(
  policyId: string,
  _prevState: LinkHouseholdFormState,
  formData: FormData
): Promise<LinkHouseholdFormState> {
  const actor = await requireSessionUser();
  const householdId = String(formData.get("householdId") ?? "");

  try {
    await linkPolicyToHousehold(actor, policyId, householdId);
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

  revalidatePath(`/policies/${policyId}`);
  return { success: true };
}
