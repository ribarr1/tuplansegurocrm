"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deactivateImmigrationDocumentAction } from "./sensitive-identity-actions";

// Desactiva (isActive=false), nunca borra la fila — conserva el
// historial del documento (mismo patrón que DeleteMedicationButton).
export function DeactivateDocumentButton({
  documentId,
  personId,
  documentLabel,
}: {
  documentId: string;
  personId: string;
  documentLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`¿Desactivar el documento "${documentLabel}"?`)) return;
        startTransition(async () => {
          const result = await deactivateImmigrationDocumentAction(documentId, personId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Desactivando…" : "Desactivar"}
    </Button>
  );
}
