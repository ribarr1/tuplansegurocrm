"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleUserActiveAction } from "./actions";

export function ToggleUserActiveButton({
  userId,
  isActive,
  isSelf = false,
}: {
  userId: string;
  isActive: boolean;
  // Fase 022 (Hallazgo #4 de UAT): un ADMIN nunca puede desactivarse a
  // sí mismo — oculto aquí (el servicio lo rechaza igual server-side,
  // ver users.service.ts::setUserActive, esto es solo la UI).
  isSelf?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (isSelf && isActive) return null;

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
