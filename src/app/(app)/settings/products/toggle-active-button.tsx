"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleProductActiveAction } from "./actions";

export function ToggleProductActiveButton({
  productId,
  isActive,
}: {
  productId: string;
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
          const result = await toggleProductActiveAction(productId, !isActive);
          if (result.error) alert(result.error);
        })
      }
    >
      {isPending ? "Guardando…" : isActive ? "Desactivar" : "Activar"}
    </Button>
  );
}
