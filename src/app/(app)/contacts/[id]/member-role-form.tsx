"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { HOUSEHOLD_MEMBER_ROLE_VALUES } from "@/schemas/household.schema";
import { HOUSEHOLD_MEMBER_ROLE_LABELS } from "@/lib/labels";
import { updateHouseholdMemberRoleAction } from "../household-actions";
import type { HouseholdMemberRole } from "@/generated/prisma/client";

export function MemberRoleForm({
  householdMemberId,
  viewedPersonId,
  currentRole,
}: {
  householdMemberId: string;
  viewedPersonId: string;
  currentRole: HouseholdMemberRole;
}) {
  const action = updateHouseholdMemberRoleAction.bind(null, householdMemberId, viewedPersonId);
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <form key={currentRole} action={formAction} className="flex items-center gap-2">
      <select
        name="role"
        defaultValue={currentRole}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {HOUSEHOLD_MEMBER_ROLE_VALUES.map((role) => (
          <option key={role} value={role}>
            {HOUSEHOLD_MEMBER_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
