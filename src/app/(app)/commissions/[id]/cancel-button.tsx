"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelCommissionExpectationAction } from "../actions";

export function CancelExpectationButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm("¿Cancelar esta comisión esperada? No se podrán registrar nuevos movimientos.")) {
          return;
        }
        startTransition(() => cancelCommissionExpectationAction(id));
      }}
    >
      {isPending ? "Guardando…" : "Cancelar comisión"}
    </Button>
  );
}
