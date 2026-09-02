"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USDateTimeInput } from "@/components/ui/us-datetime-input";
import { TASK_PRIORITY_VALUES } from "@/schemas/task.schema";
import { TASK_PRIORITY_LABELS } from "@/lib/labels";
import type { TaskFormState } from "./form-helpers";

export function TaskForm({
  action,
  personId,
  policyId,
  contextLabel,
  showAssigneeSelect,
  activeAgents = [],
}: {
  action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  personId?: string;
  policyId?: string;
  contextLabel?: string;
  showAssigneeSelect: boolean;
  activeAgents?: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-xl flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {contextLabel && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {contextLabel}
        </p>
      )}
      {personId && <input type="hidden" name="personId" value={personId} />}
      {policyId && <input type="hidden" name="policyId" value={policyId} />}

      <div className="flex flex-col gap-1">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" defaultValue={values.title ?? ""} required />
        {state?.fieldErrors?.title && (
          <p className="text-sm text-destructive">{state.fieldErrors.title}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="description">Descripción</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={values.description ?? ""}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {state?.fieldErrors?.description && (
          <p className="text-sm text-destructive">{state.fieldErrors.description}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="priority">Prioridad</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={values.priority ?? "NORMAL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dueAt">Vencimiento</Label>
          <USDateTimeInput id="dueAt" name="dueAt" defaultValue={values.dueAt ?? ""} />
          {state?.fieldErrors?.dueAt && (
            <p className="text-sm text-destructive">{state.fieldErrors.dueAt}</p>
          )}
        </div>
      </div>

      {showAssigneeSelect && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="assignedToId">Responsable</Label>
          <select
            id="assignedToId"
            name="assignedToId"
            defaultValue={values.assignedToId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin asignar</option>
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.assignedToId && (
            <p className="text-sm text-destructive">{state.fieldErrors.assignedToId}</p>
          )}
        </div>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Crear tarea"}
      </Button>
    </form>
  );
}
