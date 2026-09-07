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
        <Label htmlFor="file">Archivo (.csv, .xlsx o .pdf según la fuente elegida)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.xlsx,.pdf"
          required
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Cada fuente ya identifica agencia pagadora + modalidad (ej. &quot;Orange — Oscar (PDF, propia)&quot;) —
          elige la que corresponda al reporte real que vas a subir. Si el PDF no coincide con las columnas
          esperadas de esa fuente, la subida se rechaza con un mensaje claro (nunca se adivina el formato).
          Las fuentes marcadas &quot;PDF — pendiente&quot; todavía no procesan el contenido del PDF — sube
          igual para confirmar el archivo, pero verás un aviso indicando que el adaptador está pendiente.
        </p>
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Subiendo…" : "Subir y previsualizar"}
      </Button>
    </form>
  );
}
