"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { applyCommissionStatementAction } from "../actions";

export function ApplyStatementButton({
  statementId,
  pendingCount,
}: {
  statementId: string;
  pendingCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      disabled={isPending || pendingCount === 0}
      onClick={() => {
        if (
          !confirm(
            `Se crearán ${pendingCount} pago(s) de comisión reales a partir de las filas emparejadas. Esta acción no se puede deshacer. ¿Continuar?`
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await applyCommissionStatementAction(statementId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Aplicando…" : `Aplicar (${pendingCount} pago(s))`}
    </Button>
  );
}
