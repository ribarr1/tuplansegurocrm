"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { US_STATES } from "@/lib/us-states";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import { createAgentCarrierContractAction } from "./actions";

export function CreateContractForm({
  userId,
  carriers,
}: {
  userId: string;
  carriers: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    createAgentCarrierContractAction.bind(null, userId),
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="carrierId">Compañía</Label>
          <select
            id="carrierId"
            name="carrierId"
            className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.carrierId && (
            <p className="text-sm text-destructive">{state.fieldErrors.carrierId}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo de póliza</Label>
          <select
            id="policyType"
            name="policyType"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            {POLICY_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {POLICY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Estados (selección múltiple)</Label>
        <select
          name="states"
          multiple
          size={8}
          className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
          required
        >
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.states && <p className="text-sm text-destructive">{state.fieldErrors.states}</p>}
        <p className="text-xs text-muted-foreground">
          Ctrl/Cmd+clic para elegir varios — se crea una fila por cada estado.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Agregar contrato"}
      </Button>
    </form>
  );
}
