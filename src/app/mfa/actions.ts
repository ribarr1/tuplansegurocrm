"use server";

import { headers } from "next/headers";
import { requireSessionUserAllowMfaPending } from "@/lib/authorization";
import {
  startTotpEnrollment,
  confirmTotpEnrollment,
  regenerateBackupCodes,
  disableTotp,
  type StartTotpEnrollmentResult,
} from "@/services/mfa.service";
import { AppError } from "@/services/errors";

// PREPRODUCCIÓN — MFA. requireSessionUserAllowMfaPending() a propósito
// en TODAS estas acciones (nunca requireSessionUser): un ADMIN
// pendiente de configurar MFA necesita poder llamarlas — son
// exactamente el camino para dejar de estarlo. Ver
// src/lib/authorization.ts.

export type MfaActionState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function toFieldErrors(error: unknown): { error?: string; fieldErrors?: Record<string, string> } {
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

export async function startTotpEnrollmentAction(
  password: string
): Promise<{ data?: StartTotpEnrollmentResult; error?: string; fieldErrors?: Record<string, string> }> {
  const actor = await requireSessionUserAllowMfaPending();
  try {
    const data = await startTotpEnrollment(actor, { password }, await headers());
    return { data };
  } catch (error) {
    return toFieldErrors(error);
  }
}

export async function confirmTotpEnrollmentAction(code: string): Promise<MfaActionState> {
  const actor = await requireSessionUserAllowMfaPending();
  try {
    await confirmTotpEnrollment(actor, { code }, await headers());
    return undefined;
  } catch (error) {
    return toFieldErrors(error);
  }
}

export async function regenerateBackupCodesAction(
  password: string,
  code: string
): Promise<{ data?: { backupCodes: string[] }; error?: string; fieldErrors?: Record<string, string> }> {
  const actor = await requireSessionUserAllowMfaPending();
  try {
    const data = await regenerateBackupCodes(actor, { password, code }, await headers());
    return { data };
  } catch (error) {
    return toFieldErrors(error);
  }
}

export async function disableTotpAction(password: string, code: string): Promise<MfaActionState> {
  const actor = await requireSessionUserAllowMfaPending();
  try {
    await disableTotp(actor, { password, code }, await headers());
    return undefined;
  } catch (error) {
    return toFieldErrors(error);
  }
}
