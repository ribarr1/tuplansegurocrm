"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import { setGoogleReviewStatus } from "@/services/google-reviews.service";
import { AppError } from "@/services/errors";

// Fase 025.5 (UAT-10) — exclusivamente ADMIN; setGoogleReviewStatus lo
// vuelve a validar server-side, esto nunca es la única barrera.
export async function setGoogleReviewStatusAction(
  personId: string,
  status: "PENDING_REQUEST" | "REQUESTED" | "PUBLISHED" | "DO_NOT_REQUEST"
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setGoogleReviewStatus(actor, { personId, status });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath(`/contacts/${personId}`);
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {};
}
