"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createPolicy, updatePolicy, renewPolicy, cancelPolicy } from "@/services/policies.service";
import { AppError } from "@/services/errors";
import { autoGenerateCurrentPeriodExpectation } from "@/services/commission-rules.service";
import {
  formDataToCreatePolicyInput,
  formDataToUpdatePolicyInput,
  toPolicyFormState,
  type PolicyFormState,
} from "./form-helpers";

export type { PolicyFormState };

export async function createPolicyAction(
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const actor = await requireSessionUser();
  const input = formDataToCreatePolicyInput(formData);
  // Solo los campos escalares se repiten al usuario en caso de error —
  // ver PolicyFormState en form-helpers.ts.
  const scalarValues = Object.fromEntries(
    Object.entries(input).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>;

  let created;
  try {
    created = await createPolicy(actor, input);
  } catch (error) {
    return toPolicyFormState(error, scalarValues);
  }

  // Hallazgo #14 de UAT (Fase 019.7): si la póliza nace ACTIVE y tiene
  // una CommissionRule aplicable, genera la expectativa del mes de
  // negocio actual automáticamente — best effort, nunca bloquea la
  // creación de la póliza si algo falla aquí.
  await autoGenerateCurrentPeriodExpectation(created.id, actor);

  // Una póliza nueva puede afectar los conteos de Cartera del
  // Dashboard (Fase 018) — status inicial PENDING casi siempre.
  revalidatePath("/dashboard");
  redirect(`/policies/${created.id}`);
}

// Renovación — Fase 019.9 (§3). Reutiliza el mismo transporte de
// FormData que createPolicyAction (mismos nombres de campo); el
// servicio ignora holderId/holderCovered del formulario cuando no
// aplican, y siempre fuerza holder/household de la póliza anterior.
export async function renewPolicyAction(
  oldPolicyId: string,
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const actor = await requireSessionUser();
  const input = formDataToCreatePolicyInput(formData);
  const scalarValues = Object.fromEntries(
    Object.entries(input).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>;

  let created;
  try {
    created = await renewPolicy(actor, oldPolicyId, input);
  } catch (error) {
    return toPolicyFormState(error, scalarValues);
  }

  await autoGenerateCurrentPeriodExpectation(created.id, actor);
  revalidatePath("/dashboard");
  redirect(`/policies/${created.id}`);
}

export async function updatePolicyAction(
  id: string,
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdatePolicyInput(formData) as Record<string, string>;

  try {
    await updatePolicy(actor, id, values);
  } catch (error) {
    return toPolicyFormState(error, values);
  }

  // Hallazgo #14: activar la póliza (o cambiar la prima, si la regla
  // depende de ella) puede habilitar una expectativa nueva del mes
  // actual — best effort, ver comentario en createPolicyAction.
  await autoGenerateCurrentPeriodExpectation(id, actor);

  // status/effectiveDate pueden cambiar aquí — afecta directamente los
  // conteos Activas/Pendientes del Dashboard.
  revalidatePath("/dashboard");
  redirect(`/policies/${id}`);
}

export type CancelPolicyFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

// Cancelación guiada — Fase 020 (§4). Mismo patrón useActionState +
// diálogo que AddPolicyMemberDialog (se cierra solo al tener éxito) —
// la póliza se queda en la misma página, solo cambia su estado.
export async function cancelPolicyAction(
  policyId: string,
  _prevState: CancelPolicyFormState,
  formData: FormData
): Promise<CancelPolicyFormState> {
  const actor = await requireSessionUser();
  try {
    await cancelPolicy(actor, policyId, {
      terminationDate: formData.get("terminationDate"),
      reason: formData.get("reason") || undefined,
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
  revalidatePath(`/policies/${policyId}`);
  revalidatePath("/dashboard");
  return { success: true };
}
