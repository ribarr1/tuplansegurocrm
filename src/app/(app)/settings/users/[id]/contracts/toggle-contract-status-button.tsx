"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setAgentContractStatusAction } from "./actions";

export function ToggleContractStatusButton({
  contractId,
  userId,
  status,
}: {
  contractId: string;
  userId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setAgentContractStatusAction(
            contractId,
            userId,
            status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
          );
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Guardando…" : status === "ACTIVE" ? "Desactivar" : "Activar"}
    </Button>
  );
}
