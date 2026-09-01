"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  generateExpectationAction,
  type GenerateExpectationFormState,
} from "./generate-expectation-actions";

export function GenerateExpectationForm({ policyId }: { policyId: string }) {
  const action = generateExpectationAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState<GenerateExpectationFormState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Período</span>
        <input
          type="month"
          name="period"
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Generando…" : "Generar expectativa"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
    </form>
  );
}
