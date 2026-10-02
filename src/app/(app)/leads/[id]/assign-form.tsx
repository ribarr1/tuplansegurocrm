"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { assignLeadAction } from "./actions";

export function AssignLeadForm({
  leadId,
  currentAssignedToId,
  hasPendingTask,
  activeAgents,
}: {
  leadId: string;
  currentAssignedToId: string | null;
  hasPendingTask: boolean;
  activeAgents: { id: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await assignLeadAction(leadId, formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="assignedToId">Agente</Label>
        <select
          id="assignedToId"
          name="assignedToId"
          defaultValue={currentAssignedToId ?? ""}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Sin asignar</option>
          {activeAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {hasPendingTask && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="reassignPendingTask" className="size-4" />
          Reasignar también la tarea pendiente
        </label>
      )}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Guardando…" : "Asignar"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
