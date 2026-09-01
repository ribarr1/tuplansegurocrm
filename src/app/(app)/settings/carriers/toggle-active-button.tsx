"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleCarrierActiveAction } from "./actions";

export function ToggleCarrierActiveButton({
  carrierId,
  isActive,
}: {
  carrierId: string;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleCarrierActiveAction(carrierId, !isActive);
          if (result.error) alert(result.error);
        })
      }
    >
      {isPending ? "Guardando…" : isActive ? "Desactivar" : "Activar"}
    </Button>
  );
}
