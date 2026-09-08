"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  uploadCommissionStatement,
  manualMatchStatementRow,
  ignoreStatementRow,
  applyCommissionStatement,
} from "@/services/commission-statements/reconciliation.service";
import { searchPolicyCandidatesForRow } from "@/services/commission-statements/policy-candidates";
import { AppError } from "@/services/errors";

export type ReconciliationFormState = { error?: string; success?: true } | undefined;

export async function uploadCommissionStatementAction(
  _prevState: ReconciliationFormState,
  formData: FormData
): Promise<ReconciliationFormState> {
  const actor = await requireSessionUser();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "file: Selecciona un archivo." };
  }

  let result;
  try {
    result = await uploadCommissionStatement(actor, formData.get("source"), file);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  revalidatePath("/commissions/reconciliation");
  if (result.duplicate) {
    redirect(`/commissions/reconciliation/${result.existingStatementId}?duplicate=1`);
  }
  redirect(`/commissions/reconciliation/${result.statementId}`);
}

export async function manualMatchRowAction(
  rowId: string,
  input: { policyId: string; policyMemberId?: string | null; outOfPeriodReason?: string | null }
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const preview = await manualMatchStatementRow(actor, rowId, input);
    revalidatePath(`/commissions/reconciliation/${preview.statement.id}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function ignoreStatementRowAction(rowId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const preview = await ignoreStatementRow(actor, rowId);
    revalidatePath(`/commissions/reconciliation/${preview.statement.id}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function searchPolicyCandidatesForRowAction(rowId: string, search: string) {
  const actor = await requireSessionUser();
  try {
    return await searchPolicyCandidatesForRow(actor, rowId, search);
  } catch {
    return [];
  }
}

export async function applyCommissionStatementAction(statementId: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await applyCommissionStatement(actor, statementId);
    revalidatePath(`/commissions/reconciliation/${statementId}`);
    revalidatePath("/commissions/reconciliation");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
