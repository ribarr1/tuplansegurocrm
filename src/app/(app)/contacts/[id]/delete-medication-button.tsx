"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteMedicationAction } from "./health-records-actions";

// "Eliminar" aquí marca isActive=false en el servicio (nunca borra la
// fila) — conserva el historial, ver health-records.service.ts.
export function DeleteMedicationButton({
  medicationId,
  personId,
  medicationName,
}: {
  medicationId: string;
  personId: string;
  medicationName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`¿Eliminar ${medicationName} de la lista de medicamentos?`)) return;
        startTransition(async () => {
          const result = await deleteMedicationAction(medicationId, personId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}
