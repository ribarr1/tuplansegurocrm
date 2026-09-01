"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  markPaymentCurrentAction,
  markPaymentDueAction,
  markPaymentPastDueAction,
} from "./premium/actions";
import type { PaymentStatus } from "@/generated/prisma/client";

// Cambian ÚNICAMENTE paymentStatus — nunca nextPaymentDueDate (ver
// docs/DECISIONS.md: avanzar la fecha automáticamente asumiría un
// calendario de facturación del carrier que no tenemos).
export function QuickPaymentStatusButtons({
  policyId,
  currentStatus,
}: {
  policyId: string;
  currentStatus: PaymentStatus | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant={currentStatus === "CURRENT" ? "default" : "outline"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await markPaymentCurrentAction(policyId);
            if (result.error) alert(result.error);
          })
        }
      >
        Marcar al día
      </Button>
      <Button
        type="button"
        size="sm"
        variant={currentStatus === "DUE" ? "default" : "outline"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await markPaymentDueAction(policyId);
            if (result.error) alert(result.error);
          })
        }
      >
        Marcar por vencer
      </Button>
      <Button
        type="button"
        size="sm"
        variant={currentStatus === "PAST_DUE" ? "default" : "outline"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await markPaymentPastDueAction(policyId);
            if (result.error) alert(result.error);
          })
        }
      >
        Marcar vencido
      </Button>
    </div>
  );
}
