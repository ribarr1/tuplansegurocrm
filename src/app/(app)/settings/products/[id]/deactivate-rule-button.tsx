"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deactivateCommissionRuleAction } from "./commission-rules-actions";

export function DeactivateRuleButton({ productId, ruleId }: { productId: string; ruleId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm("¿Desactivar esta regla de comisión? Las expectativas ya generadas no cambian.")) return;
        startTransition(() => deactivateCommissionRuleAction(productId, ruleId));
      }}
    >
      {isPending ? "Desactivando…" : "Desactivar"}
    </Button>
  );
}
