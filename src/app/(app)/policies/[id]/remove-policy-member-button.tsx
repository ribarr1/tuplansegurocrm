"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removePolicyMemberAction } from "./policy-members-actions";

// Quita únicamente la fila PolicyMember — nunca borra la Person ni su
// HouseholdMember (hallazgo #12 de UAT: sigue en el hogar, solo deja
// de estar cubierto por ESTA póliza).
export function RemovePolicyMemberButton({
  policyId,
  policyMemberId,
  personName,
}: {
  policyId: string;
  policyMemberId: string;
  personName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`¿Quitar a ${personName} de esta póliza? Seguirá en el hogar y en el CRM.`)) return;
        startTransition(async () => {
          const result = await removePolicyMemberAction(policyId, policyMemberId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Quitando…" : "Quitar de la póliza"}
    </Button>
  );
}
