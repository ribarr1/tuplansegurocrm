"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  markBirthdayGreetingSent,
  markBirthdayGreetingSkipped,
  resetBirthdayGreeting,
} from "@/services/birthdays.service";
import { AppError } from "@/services/errors";

export type BirthdayActionState = { error?: string } | undefined;

export async function markBirthdaySentAction(
  personId: string,
  channel: string
): Promise<BirthdayActionState> {
  const actor = await requireSessionUser();
  try {
    await markBirthdayGreetingSent(actor, { personId, channel });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/birthdays");
  revalidatePath("/dashboard");
  revalidatePath(`/contacts/${personId}`);
}

export async function markBirthdaySkippedAction(personId: string): Promise<BirthdayActionState> {
  const actor = await requireSessionUser();
  try {
    await markBirthdayGreetingSkipped(actor, { personId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/birthdays");
  revalidatePath("/dashboard");
  revalidatePath(`/contacts/${personId}`);
}

export async function resetBirthdayGreetingAction(personId: string): Promise<BirthdayActionState> {
  const actor = await requireSessionUser();
  try {
    await resetBirthdayGreeting(actor, { personId });
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
  revalidatePath("/birthdays");
  revalidatePath("/dashboard");
  revalidatePath(`/contacts/${personId}`);
}
