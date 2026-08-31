"use server";

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { createPerson, updatePerson } from "@/services/people.service";
import { formDataToPersonInput, toFormState, type PersonFormState } from "./form-helpers";

export type { PersonFormState };

export async function createPersonAction(
  _prevState: PersonFormState,
  formData: FormData
): Promise<PersonFormState> {
  const actor = await requireSessionUser();
  const values = formDataToPersonInput(formData);

  let created;
  try {
    created = await createPerson(actor, values);
  } catch (error) {
    return toFormState(error, values);
  }

  redirect(`/contacts/${created.id}`);
}

export async function updatePersonAction(
  id: string,
  _prevState: PersonFormState,
  formData: FormData
): Promise<PersonFormState> {
  const actor = await requireSessionUser();
  const values = formDataToPersonInput(formData);

  try {
    await updatePerson(actor, id, values);
  } catch (error) {
    return toFormState(error, values);
  }

  redirect(`/contacts/${id}`);
}
