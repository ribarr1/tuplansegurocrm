"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-feedback";
import { uploadCommissionStatementAction } from "./actions";

export function UploadStatementForm({ sources }: { sources: { source: string; label: string }[] }) {
  const [state, formAction, isPending] = useActionState(uploadCommissionStatementAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-md">
      <FormError message={state?.error} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="source">Fuente / formato</Label>
        <select
          id="source"
          name="source"
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {sources.map((s) => (
            <option key={s.source} value={s.source}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="file">Archivo (.csv o .xlsx)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.xlsx"
          required
          className="text-sm"
        />
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Subiendo…" : "Subir y previsualizar"}
      </Button>
    </form>
  );
}
