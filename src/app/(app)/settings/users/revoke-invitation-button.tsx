"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "./actions";

// PREPRODUCCIÓN — solo ADMIN puede revocar (reforzado server-side; esta
// UI ya solo se renderiza para ADMIN, ver page.tsx).
export function RevokeInvitationButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm("¿Revocar esta invitación? El enlace enviado dejará de funcionar de inmediato.")) return;
        startTransition(async () => {
          const result = await revokeInvitationAction(userId);
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Revocando…" : "Revocar invitación"}
    </Button>
  );
}
