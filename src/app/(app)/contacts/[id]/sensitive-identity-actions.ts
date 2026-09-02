"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  updateImmigrationCategory,
  setSsn,
  removeSsn,
  revealSsn,
  setUscisNumber,
  removeUscisNumber,
  revealUscisNumber,
  createImmigrationDocument,
  updateImmigrationDocument,
  deactivateImmigrationDocument,
  revealImmigrationDocumentNumber,
} from "@/services/sensitive-identity.service";
import { AppError } from "@/services/errors";

// Identidad sensible del contacto — Fase 021. Las acciones de "Mostrar"
// (reveal*Action) SOLO retornan el valor completo al cliente que la
// invocó explícitamente vía el botón "Mostrar" — nunca se precargan en
// props iniciales ni se cachean (una Server Action de Next.js siempre
// se ejecuta como POST, nunca servida desde caché — ver
// docs/SENSITIVE_PII.md, §17-§19 de la ficha).

export type SensitiveIdentityFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

function fieldErrorFrom(error: AppError): SensitiveIdentityFormState {
  if (error.code === "VALIDATION_ERROR") {
    const sep = error.message.indexOf(": ");
    if (sep > 0) {
      return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
    }
  }
  return { error: error.message };
}

export async function updateImmigrationCategoryAction(
  personId: string,
  _prevState: SensitiveIdentityFormState,
  formData: FormData
): Promise<SensitiveIdentityFormState> {
  const actor = await requireSessionUser();
  try {
    await updateImmigrationCategory(actor, {
      personId,
      immigrationCategory: String(formData.get("immigrationCategory") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function setSsnAction(
  personId: string,
  _prevState: SensitiveIdentityFormState,
  formData: FormData
): Promise<SensitiveIdentityFormState> {
  const actor = await requireSessionUser();
  try {
    await setSsn(actor, { personId, ssn: String(formData.get("ssn") ?? "") });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function removeSsnAction(personId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await removeSsn(actor, { personId });
    revalidatePath(`/contacts/${personId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function revealSsnAction(personId: string): Promise<{ value?: string; error?: string }> {
  const actor = await requireSessionUser();
  try {
    return { value: await revealSsn(actor, { personId }) };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function setUscisNumberAction(
  personId: string,
  _prevState: SensitiveIdentityFormState,
  formData: FormData
): Promise<SensitiveIdentityFormState> {
  const actor = await requireSessionUser();
  try {
    await setUscisNumber(actor, { personId, uscisNumber: String(formData.get("uscisNumber") ?? "") });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function removeUscisNumberAction(personId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await removeUscisNumber(actor, { personId });
    revalidatePath(`/contacts/${personId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function revealUscisNumberAction(personId: string): Promise<{ value?: string; error?: string }> {
  const actor = await requireSessionUser();
  try {
    return { value: await revealUscisNumber(actor, { personId }) };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function createImmigrationDocumentAction(
  personId: string,
  _prevState: SensitiveIdentityFormState,
  formData: FormData
): Promise<SensitiveIdentityFormState> {
  const actor = await requireSessionUser();
  try {
    await createImmigrationDocument(actor, {
      personId,
      documentType: String(formData.get("documentType") ?? ""),
      documentNumber: String(formData.get("documentNumber") ?? ""),
      issuedDate: String(formData.get("issuedDate") ?? "") || undefined,
      expirationDate: String(formData.get("expirationDate") ?? "") || undefined,
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function updateImmigrationDocumentAction(
  documentId: string,
  personId: string,
  _prevState: SensitiveIdentityFormState,
  formData: FormData
): Promise<SensitiveIdentityFormState> {
  const actor = await requireSessionUser();
  try {
    const documentNumberRaw = formData.get("documentNumber");
    await updateImmigrationDocument(actor, documentId, {
      documentType: String(formData.get("documentType") ?? ""),
      documentNumber: documentNumberRaw ? String(documentNumberRaw) : undefined,
      issuedDate: String(formData.get("issuedDate") ?? ""),
      expirationDate: String(formData.get("expirationDate") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) return fieldErrorFrom(error);
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function deactivateImmigrationDocumentAction(
  documentId: string,
  personId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await deactivateImmigrationDocument(actor, documentId);
    revalidatePath(`/contacts/${personId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function revealImmigrationDocumentNumberAction(
  documentId: string
): Promise<{ value?: string; error?: string }> {
  const actor = await requireSessionUser();
  try {
    return { value: await revealImmigrationDocumentNumber(actor, documentId) };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
