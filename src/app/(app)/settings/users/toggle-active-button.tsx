"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleUserActiveAction } from "./actions";

export function ToggleUserActiveButton({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await toggleUserActiveAction(userId, !isActive);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Guardando…" : isActive ? "Desactivar" : "Activar"}
    </Button>
  );
}
