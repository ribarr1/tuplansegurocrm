"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  createPaymentMethod,
  updatePaymentMethod,
  setDefaultPaymentMethod,
  revokePaymentMethod,
  revealPaymentMethodFull,
  recordPaymentMethodFieldCopy,
  replacePaymentMethodSecret,
  type RevealedPaymentMethod,
} from "@/services/payment-methods.service";
import { AppError } from "@/services/errors";

export type PaymentMethodFormState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: true }
  | undefined;

function toFieldErrors(error: unknown): PaymentMethodFormState {
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

export async function createPaymentMethodAction(
  personId: string,
  _prevState: PaymentMethodFormState,
  formData: FormData
): Promise<PaymentMethodFormState> {
  const actor = await requireSessionUser();
  const type = String(formData.get("type") ?? "");
  const base = {
    personId,
    type,
    policyId: String(formData.get("policyId") ?? "") || undefined,
    isDefault: formData.get("isDefault") === "on",
    autopay: formData.get("autopay") === "on",
    comment: String(formData.get("comment") ?? "") || undefined,
    consentGiven: formData.get("consentGiven") === "on",
    consentUse: String(formData.get("consentUse") ?? "") || undefined,
    billingAddressLine1: String(formData.get("billingAddressLine1") ?? "") || undefined,
    billingAddressLine2: String(formData.get("billingAddressLine2") ?? "") || undefined,
    billingCity: String(formData.get("billingCity") ?? "") || undefined,
    billingState: String(formData.get("billingState") ?? "") || undefined,
    billingZipCode: String(formData.get("billingZipCode") ?? "") || undefined,
  };
  const typed =
    type === "BANK_ACCOUNT"
      ? {
          ...base,
          bankAccountHolderName: String(formData.get("bankAccountHolderName") ?? ""),
          bankName: String(formData.get("bankName") ?? ""),
          routingNumber: String(formData.get("routingNumber") ?? ""),
          accountNumber: String(formData.get("accountNumber") ?? ""),
          bankAccountType: String(formData.get("bankAccountType") ?? ""),
        }
      : {
          ...base,
          cardholderName: String(formData.get("cardholderName") ?? ""),
          cardNumber: String(formData.get("cardNumber") ?? ""),
          cardExpMonth: String(formData.get("cardExpMonth") ?? ""),
          cardExpYear: String(formData.get("cardExpYear") ?? ""),
          cardBrand: String(formData.get("cardBrand") ?? ""),
        };

  try {
    await createPaymentMethod(actor, typed);
  } catch (error) {
    return toFieldErrors(error);
  }
  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function updatePaymentMethodAction(
  id: string,
  personId: string,
  input: {
    autopay?: boolean;
    comment?: string;
    policyId?: string | null;
    cardExpMonth?: number;
    cardExpYear?: number;
  }
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await updatePaymentMethod(actor, id, input);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return {};
}

export async function setDefaultPaymentMethodAction(
  personId: string,
  paymentMethodId: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setDefaultPaymentMethod(actor, { personId, paymentMethodId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return {};
}

export async function revokePaymentMethodAction(
  id: string,
  personId: string,
  reason?: string
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await revokePaymentMethod(actor, id, { reason });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return {};
}

// La reautenticación necesita los headers de la petición ACTUAL
// (cookie de sesión) — se obtienen aquí con next/headers() y se pasan
// explícitamente al servicio, nunca al revés.
//
// Revela el CONJUNTO COMPLETO de datos del método con UNA sola
// reautenticación — nunca campo por campo (ver
// payment-methods.service.ts::revealPaymentMethodFull).
export async function revealPaymentMethodFullAction(
  id: string,
  input: { password: string; totpCode: string; reason: string; policyId?: string }
): Promise<{ data?: RevealedPaymentMethod; error?: string }> {
  const actor = await requireSessionUser();
  try {
    const data = await revealPaymentMethodFull(actor, id, input, await headers());
    return { data };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

// Fire-and-forget: la copia real ya ocurrió del lado del cliente
// (navigator.clipboard) — este audit nunca debe bloquear ni poder
// "fallar" la experiencia de copiar, y nunca recibe el valor copiado,
// solo el nombre del campo.
export async function copyPaymentMethodFieldAction(id: string, field: string): Promise<void> {
  const actor = await requireSessionUser();
  try {
    await recordPaymentMethodFieldCopy(actor, id, field);
  } catch {
    // Ver comentario arriba — nunca se propaga al cliente.
  }
}

export async function replacePaymentMethodSecretAction(
  id: string,
  personId: string,
  input: { password: string; field: string; value: string }
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await replacePaymentMethodSecret(actor, id, input, await headers());
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  return {};
}
