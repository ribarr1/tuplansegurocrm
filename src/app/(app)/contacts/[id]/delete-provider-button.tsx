"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteProviderAction } from "./health-records-actions";

export function DeleteProviderButton({
  providerId,
  personId,
  providerName,
}: {
  providerId: string;
  personId: string;
  providerName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`¿Eliminar a ${providerName} de proveedores preferidos?`)) return;
        startTransition(async () => {
          const result = await deleteProviderAction(providerId, personId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}
