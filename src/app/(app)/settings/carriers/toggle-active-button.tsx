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
      onClick={() => startTransition(() => toggleCarrierActiveAction(carrierId, !isActive))}
    >
      {isPending ? "Guardando…" : isActive ? "Desactivar" : "Activar"}
    </Button>
  );
}
