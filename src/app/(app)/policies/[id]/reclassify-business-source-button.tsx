"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reclassifyPolicyBusinessSourceAction } from "../actions";

// Fase 025.4 (UAT-03): solo aparece cuando businessSource=UNKNOWN — el
// servicio rechaza reclasificar una póliza ya OWN/REFERRAL (histórico,
// nunca recalculado).
export function ReclassifyBusinessSourceButton({ policyId }: { policyId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await reclassifyPolicyBusinessSourceAction(policyId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Reclasificando…" : "Reclasificar"}
    </Button>
  );
}
