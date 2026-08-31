"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUser } from "@/lib/authorization";
import {
  createHouseholdWithInitialMember,
  addHouseholdMember,
  removeHouseholdMember,
  updateHouseholdMemberRole,
  createPersonAndAddToHousehold,
} from "@/services/households.service";
import { listPeople } from "@/services/people.service";
import {
  toHouseholdFormState,
  formDataToRecord,
  type HouseholdFormState,
  type SearchPeopleState,
} from "./household-form-helpers";

export type { HouseholdFormState, SearchPeopleState };

export async function createHouseholdAction(
  personId: string,
  _prevState: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const actor = await requireSessionUser();
  const values = formDataToRecord(formData, ["role", "name"]);

  try {
    await createHouseholdWithInitialMember(actor, { personId, ...values });
  } catch (error) {
    return toHouseholdFormState(error, values);
  }

  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function addHouseholdMemberAction(
  householdId: string,
  personId: string,
  _prevState: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const actor = await requireSessionUser();
  const values = formDataToRecord(formData, ["personId", "role"]);

  try {
    await addHouseholdMember(actor, householdId, values);
  } catch (error) {
    return toHouseholdFormState(error, values);
  }

  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function removeHouseholdMemberAction(
  householdMemberId: string,
  personId: string
) {
  const actor = await requireSessionUser();
  await removeHouseholdMember(actor, householdMemberId);
  revalidatePath(`/contacts/${personId}`);
}

export async function updateHouseholdMemberRoleAction(
  householdMemberId: string,
  personId: string,
  _prevState: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const actor = await requireSessionUser();
  const values = formDataToRecord(formData, ["role"]);

  try {
    await updateHouseholdMemberRole(actor, householdMemberId, values);
  } catch (error) {
    return toHouseholdFormState(error, values);
  }

  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function createPersonAndAddAction(
  householdId: string,
  personId: string,
  _prevState: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const actor = await requireSessionUser();
  const values = formDataToRecord(formData, [
    "firstName",
    "lastName",
    "phone",
    "email",
    "dateOfBirth",
    "contactStatus",
    "role",
  ]);

  try {
    await createPersonAndAddToHousehold(actor, householdId, values);
  } catch (error) {
    return toHouseholdFormState(error, values);
  }

  revalidatePath(`/contacts/${personId}`);
  return { success: true };
}

export async function searchPeopleAction(
  _prevState: SearchPeopleState,
  formData: FormData
): Promise<SearchPeopleState> {
  const actor = await requireSessionUser();
  const search = String(formData.get("search") ?? "").trim();
  if (!search) return { results: [], searched: false };

  const { items } = await listPeople(actor, { search, page: 1, pageSize: 10 });
  return {
    results: items.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email,
    })),
    searched: true,
  };
}
