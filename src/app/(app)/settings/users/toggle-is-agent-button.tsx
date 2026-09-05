"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleUserIsAgentAction } from "./actions";

// Fase 025.4 (UAT-03/07): "¿Este usuario también es agente?" —
// independiente de `role`. Oculto para role=AGENT (siempre es agente,
// ver users.service.ts::setUserIsAgent, que además lo rechaza
// server-side si alguien intentara desmarcarlo por esta vía).
export function ToggleUserIsAgentButton({
  userId,
  role,
  isAgent,
}: {
  userId: string;
  role: string;
  isAgent: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (role === "AGENT") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await toggleUserIsAgentAction(userId, !isAgent);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Guardando…" : isAgent ? "Quitar condición de agente" : "Marcar como agente"}
    </Button>
  );
}
