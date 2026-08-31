"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markBirthdaySkippedAction, resetBirthdayGreetingAction } from "./actions";

export function SkipGreetingButton({ personId }: { personId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleClick() {
    startTransition(async () => {
      const result = await markBirthdaySkippedAction(personId);
      setError(result?.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
        {isPending ? "Guardando…" : "Omitir este año"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// Solo ADMIN — el servicio ya lo exige, este botón solo se renderiza
// para ADMIN en la UI (ver birthdays/page.tsx).
export function ResetGreetingButton({ personId }: { personId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleClick() {
    startTransition(async () => {
      const result = await resetBirthdayGreetingAction(personId);
      setError(result?.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleClick}>
        {isPending ? "Guardando…" : "Restablecer"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
