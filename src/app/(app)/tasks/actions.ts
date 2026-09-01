"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import { createTask, updateTask, completeTask, cancelTask } from "@/services/tasks.service";
import {
  formDataToCreateTaskInput,
  formDataToUpdateTaskInput,
  toTaskFormState,
  type TaskFormState,
} from "./form-helpers";

export type { TaskFormState };

export async function createTaskAction(
  _prevState: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const actor = await requireSessionUser();
  const values = formDataToCreateTaskInput(formData);

  let created;
  try {
    created = await createTask(actor, values);
  } catch (error) {
    return toTaskFormState(error, values);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (values.personId) revalidatePath(`/contacts/${values.personId}`);
  if (values.policyId) revalidatePath(`/policies/${values.policyId}`);
  redirect(`/tasks/${created.id}`);
}

export async function updateTaskAction(
  id: string,
  _prevState: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const actor = await requireSessionUser();
  const values = formDataToUpdateTaskInput(formData);

  let updated;
  try {
    updated = await updateTask(actor, id, values);
  } catch (error) {
    return toTaskFormState(error, values);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath(`/tasks/${id}`);
  if (updated.person) revalidatePath(`/contacts/${updated.person.id}`);
  if (updated.policy) revalidatePath(`/policies/${updated.policy.id}`);
  redirect(`/tasks/${id}`);
}

// Retorna el error en vez de lanzarlo — invocado "fire and forget" vía
// useTransition (TaskActionButtons), sin useActionState.
export async function completeTaskAction(id: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const updated = await completeTask(actor, id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath(`/tasks/${id}`);
    if (updated.person) revalidatePath(`/contacts/${updated.person.id}`);
    if (updated.policy) revalidatePath(`/policies/${updated.policy.id}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}

export async function cancelTaskAction(id: string): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    const updated = await cancelTask(actor, id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath(`/tasks/${id}`);
    if (updated.person) revalidatePath(`/contacts/${updated.person.id}`);
    if (updated.policy) revalidatePath(`/policies/${updated.policy.id}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
