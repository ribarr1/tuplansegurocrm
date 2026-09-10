"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resendInvitationAction } from "./actions";

// CORRECCIÓN (activación de usuarios) — solo ADMIN puede reenviar
// (reforzado server-side; esta UI ya solo se renderiza para ADMIN, ver
// page.tsx).
export function ResendInvitationButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await resendInvitationAction(userId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Enviando…" : "Reenviar invitación"}
    </Button>
  );
}
