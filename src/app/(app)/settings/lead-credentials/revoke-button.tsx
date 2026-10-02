"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokeLeadCredentialAction } from "./actions";

export function RevokeCredentialButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeLeadCredentialAction(id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" size="sm" onClick={handleRevoke} disabled={isPending}>
        {isPending ? "Revocando…" : "Revocar"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
