"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TASK_STATUS_VALUES, TASK_PRIORITY_VALUES } from "@/schemas/task.schema";
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";
import type { TaskFormState } from "../form-helpers";

export type EditTaskDefaultValues = {
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueAt?: string;
  assignedToId?: string;
};

export function EditTaskForm({
  action,
  defaultValues,
  showAssigneeSelect,
  activeAgents = [],
}: {
  action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  defaultValues: EditTaskDefaultValues;
  showAssigneeSelect: boolean;
  activeAgents?: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = { ...defaultValues, ...(state?.values ?? {}) };
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-xl flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" defaultValue={values.title} required />
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
          <Label htmlFor="status">Estado</Label>
          <select
            id="status"
            name="status"
            defaultValue={values.status}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.status && (
            <p className="text-sm text-destructive">{state.fieldErrors.status}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="priority">Prioridad</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={values.priority}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dueAt">Vencimiento (MM/DD/AAAA)</Label>
        <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={values.dueAt ?? ""} />
        {state?.fieldErrors?.dueAt && (
          <p className="text-sm text-destructive">{state.fieldErrors.dueAt}</p>
        )}
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
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
