"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommissionFormState } from "../form-helpers";

export function EditExpectationForm({
  action,
  expectedAmount,
  period,
  agentId,
  activeAgents,
  periodEditable,
}: {
  action: (state: CommissionFormState, formData: FormData) => Promise<CommissionFormState>;
  expectedAmount: string;
  period: string;
  agentId: string;
  activeAgents: { id: string; name: string }[];
  periodEditable: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? { expectedAmount, period, agentId };
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-sm font-medium">Editar comisión esperada</h3>
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="period">Período</Label>
          <Input
            id="period"
            name="period"
            type="month"
            defaultValue={values.period}
            disabled={!periodEditable}
          />
          {!periodEditable && (
            <p className="text-xs text-muted-foreground">
              No se puede cambiar: esta comisión ya tiene movimientos registrados.
            </p>
          )}
          {state?.fieldErrors?.period && (
            <p className="text-sm text-destructive">{state.fieldErrors.period}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="expectedAmount">Monto esperado</Label>
          <Input id="expectedAmount" name="expectedAmount" defaultValue={values.expectedAmount} />
          {state?.fieldErrors?.expectedAmount && (
            <p className="text-sm text-destructive">{state.fieldErrors.expectedAmount}</p>
          )}
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="overrideReason">Motivo del cambio (opcional)</Label>
          <Input
            id="overrideReason"
            name="overrideReason"
            placeholder="Ej. bono del carrier, corrección contractual…"
          />
          <p className="text-xs text-muted-foreground">
            Solo se guarda si el monto esperado cambia respecto al calculado por la regla.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="agentId">Agente</Label>
          <select
            id="agentId"
            name="agentId"
            defaultValue={values.agentId}
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
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
