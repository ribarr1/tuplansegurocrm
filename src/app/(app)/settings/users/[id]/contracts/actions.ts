"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { createAgentCarrierContract, updateAgentCarrierContract } from "@/services/agent-carrier-contracts.service";
import { AppError } from "@/services/errors";

export type ContractFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function createAgentCarrierContractAction(
  userId: string,
  _prevState: ContractFormState,
  formData: FormData
): Promise<ContractFormState> {
  const actor = await requireSessionUser();
  try {
    await createAgentCarrierContract(actor, {
      userId,
      carrierId: String(formData.get("carrierId") ?? ""),
      policyType: String(formData.get("policyType") ?? ""),
      states: formData.getAll("states").map(String),
      status: "ACTIVE",
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    if (error instanceof AppError) {
      const sep = error.message.indexOf(": ");
      if (error.code === "VALIDATION_ERROR" && sep > 0) {
        return { fieldErrors: { [error.message.slice(0, sep)]: error.message.slice(sep + 2) } };
      }
      return { error: error.message };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/contracts`);
  return undefined;
}

export async function setAgentContractStatusAction(
  contractId: string,
  userId: string,
  status: "ACTIVE" | "INACTIVE"
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await updateAgentCarrierContract(actor, contractId, { status });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/settings/users/${userId}/contracts`);
  return {};
}
