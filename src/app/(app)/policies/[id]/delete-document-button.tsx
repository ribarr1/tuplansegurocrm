"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deletePolicyDocumentAction } from "./documents-actions";

export function DeleteDocumentButton({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`¿Eliminar "${fileName}"? Esta acción no se puede deshacer.`)) return;
        startTransition(async () => {
          const result = await deletePolicyDocumentAction(documentId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}
