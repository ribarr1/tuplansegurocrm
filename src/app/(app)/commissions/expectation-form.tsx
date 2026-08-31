"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommissionFormState } from "./form-helpers";

export function ExpectationForm({
  action,
  policyId,
  policyLabel,
  activeAgents,
  defaultAgentId,
}: {
  action: (state: CommissionFormState, formData: FormData) => Promise<CommissionFormState>;
  policyId: string;
  policyLabel: string;
  activeAgents: { id: string; name: string }[];
  defaultAgentId?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <input type="hidden" name="policyId" value={policyId} />
      <div className="flex flex-col gap-1">
        <Label>Póliza</Label>
        <p className="text-sm">{policyLabel}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="period">Período (mes y año)</Label>
        <Input
          id="period"
          name="period"
          type="month"
          required
          defaultValue={values.period ?? ""}
        />
        {state?.fieldErrors?.period && (
          <p className="text-sm text-destructive">{state.fieldErrors.period}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="expectedAmount">Monto esperado</Label>
        <Input
          id="expectedAmount"
          name="expectedAmount"
          placeholder="Ej. 125.50"
          required
          defaultValue={values.expectedAmount ?? ""}
        />
        {state?.fieldErrors?.expectedAmount && (
          <p className="text-sm text-destructive">{state.fieldErrors.expectedAmount}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="agentId">Agente</Label>
        <select
          id="agentId"
          name="agentId"
          defaultValue={values.agentId ?? defaultAgentId ?? ""}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Sin asignar</option>
          {activeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.agentId && (
          <p className="text-sm text-destructive">{state.fieldErrors.agentId}</p>
        )}
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Crear comisión esperada"}
      </Button>
    </form>
  );
}
