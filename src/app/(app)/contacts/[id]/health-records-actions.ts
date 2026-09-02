"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  createPersonMedication,
  updatePersonMedication,
  deletePersonMedication,
  createPersonProvider,
  updatePersonProvider,
  deletePersonProvider,
} from "@/services/health-records.service";
import { AppError } from "@/services/errors";

// Hallazgo #18 de UAT (Fase 019.8): medicamentos y proveedores/médicos
// preferidos, manuales para V1 (sin catálogo). Mismo patrón de
// feedback estandarizado que el resto de la app (Ticket A, UAT
// hallazgos #009-#011): FormSuccess/FormError/FieldError, nunca un
// guardado silencioso.

export type MedicationFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

function fieldErrorFrom(error: AppError): MedicationFormState {
  if (error.code === "VALIDATION_ERROR") {
    const sep = error.message.indexOf(": ");
    if (sep > 0) {
      return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
    }
  }
  return { error: error.message };
}

export async function createMedicationAction(
  personId: string,
  _prevState: MedicationFormState,
  formData: FormData
): Promise<MedicationFormState> {
  const actor = await requireSessionUser();
  try {
    await createPersonMedication(actor, {
      personId,
      name: String(formData.get("name") ?? ""),
      dosage: String(formData.get("dosage") ?? ""),
      frequency: String(formData.get("frequency") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function updateMedicationAction(
  medicationId: string,
  personId: string,
  _prevState: MedicationFormState,
  formData: FormData
): Promise<MedicationFormState> {
  const actor = await requireSessionUser();
  try {
    await updatePersonMedication(actor, medicationId, {
      name: String(formData.get("name") ?? ""),
      dosage: String(formData.get("dosage") ?? ""),
      frequency: String(formData.get("frequency") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

// Fire-and-forget, mismo patrón que removePolicyMemberAction.
export async function deleteMedicationAction(
  medicationId: string,
  personId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deletePersonMedication(actor, medicationId);
    revalidatePath(`/contacts/${personId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export type ProviderFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

export async function createProviderAction(
  personId: string,
  _prevState: ProviderFormState,
  formData: FormData
): Promise<ProviderFormState> {
  const actor = await requireSessionUser();
  try {
    await createPersonProvider(actor, {
      personId,
      type: String(formData.get("type") ?? ""),
      name: String(formData.get("name") ?? ""),
      specialty: String(formData.get("specialty") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      organization: String(formData.get("organization") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function updateProviderAction(
  providerId: string,
  personId: string,
  _prevState: ProviderFormState,
  formData: FormData
): Promise<ProviderFormState> {
  const actor = await requireSessionUser();
  try {
    await updatePersonProvider(actor, providerId, {
      type: String(formData.get("type") ?? ""),
      name: String(formData.get("name") ?? ""),
      specialty: String(formData.get("specialty") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      organization: String(formData.get("organization") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function deleteProviderAction(
  providerId: string,
  personId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deletePersonProvider(actor, providerId);
    revalidatePath(`/contacts/${personId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
