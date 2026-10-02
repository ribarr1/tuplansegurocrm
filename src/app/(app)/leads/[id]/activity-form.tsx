"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_ACTIVITY_TYPE_VALUES } from "@/schemas/lead.schema";
import { LEAD_ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { addLeadActivityAction } from "./actions";

export function ActivityForm({ leadId }: { leadId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addLeadActivityAction(leadId, formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-sm font-medium">Registrar actividad</h3>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="type">Tipo</Label>
          <select id="type" name="type" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            {LEAD_ACTIVITY_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {LEAD_ACTIVITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="nextActionAt">Próxima acción (opcional)</Label>
          <Input id="nextActionAt" name="nextActionAt" type="datetime-local" />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="outcome">Resultado (opcional)</Label>
          <Input id="outcome" name="outcome" placeholder="Ej. no contestó, interesado, pidió llamar luego…" />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="note">Nota (opcional)</Label>
          <Input id="note" name="note" />
        </div>
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Registrar"}
      </Button>
    </form>
  );
}
