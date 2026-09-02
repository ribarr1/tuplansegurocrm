"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ignoreStatementRowAction } from "../actions";

export function IgnoreRowButton({ rowId }: { rowId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm("¿Ignorar esta fila? No generará ningún pago.")) return;
        startTransition(async () => {
          const result = await ignoreStatementRowAction(rowId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "…" : "Ignorar"}
    </Button>
  );
}
