"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setGoogleReviewStatusAction } from "./google-review-actions";

type Status = "PENDING_REQUEST" | "REQUESTED" | "PUBLISHED" | "DO_NOT_REQUEST";

// Fase 025.5 (UAT-10) — acciones rápidas administrativas. Solo se
// ofrecen las transiciones que tienen sentido desde el estado actual
// (nunca "marcar publicada" dos veces seguidas sin razón, aunque el
// servicio lo permitiría igual — es solo conveniencia de UI).
export function GoogleReviewStatusActions({
  personId,
  currentStatus,
}: {
  personId: string;
  currentStatus: Status;
}) {
  const [isPending, startTransition] = useTransition();

  function setStatus(status: Status) {
    startTransition(async () => {
      const result = await setGoogleReviewStatusAction(personId, status);
      if (result.error) alert(result.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {currentStatus !== "REQUESTED" && (
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setStatus("REQUESTED")}>
          Marcar solicitada
        </Button>
      )}
      {currentStatus !== "PUBLISHED" && (
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setStatus("PUBLISHED")}>
          Marcar publicada
        </Button>
      )}
      {currentStatus !== "DO_NOT_REQUEST" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setStatus("DO_NOT_REQUEST")}
        >
          No solicitar
        </Button>
      )}
      {currentStatus !== "PENDING_REQUEST" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setStatus("PENDING_REQUEST")}
        >
          Volver a pendiente
        </Button>
      )}
    </div>
  );
}
