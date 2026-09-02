"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form-feedback";
import { HOUSEHOLD_MEMBER_ROLE_LABELS } from "@/lib/labels";
import type { HouseholdMemberRole } from "@/generated/prisma/client";
import { linkPolicyToHouseholdAction } from "./policy-members-actions";

export type HouseholdLinkCandidate = {
  householdId: string;
  members: { role: HouseholdMemberRole; person: { firstName: string; lastName: string } }[];
};

function describeHousehold(candidate: HouseholdLinkCandidate): string {
  return candidate.members
    .map((m) => `${m.person.firstName} ${m.person.lastName} (${HOUSEHOLD_MEMBER_ROLE_LABELS[m.role]})`)
    .join(", ");
}

// Hallazgo #17 de UAT (Fase 019.8): cuando el Household se crea DESPUÉS
// de la póliza (o el titular pertenecía a varios hogares al crearla),
// Policy.householdId se queda null y "+ Agregar miembro" no tiene
// candidatos. Este formulario repara el vínculo explícitamente — nunca
// agrega miembros por sí solo.
export function LinkHouseholdForm({
  policyId,
  candidates,
}: {
  policyId: string;
  candidates: HouseholdLinkCandidate[];
}) {
  const action = linkPolicyToHouseholdAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState(action, undefined);

  if (candidates.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        Esta póliza todavía no está vinculada a un hogar — sin eso no se pueden ofrecer familiares como
        candidatos para cubrir.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="householdId"
          required
          defaultValue={candidates[0].householdId}
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        >
          {candidates.map((candidate) => (
            <option key={candidate.householdId} value={candidate.householdId}>
              Hogar de {describeHousehold(candidate)}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Vinculando…" : "Vincular hogar"}
        </Button>
      </div>
      {state?.success && <FormSuccess message="Hogar vinculado correctamente." />}
      <FormError message={state?.error} />
    </form>
  );
}
