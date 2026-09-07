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
        <Label htmlFor="source">Agencia y modalidad</Label>
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
        <p className="text-xs text-muted-foreground">
          Esto NUNCA es el carrier (Oscar, Ambetter, Kaiser, BCBS, Cigna...) — el carrier se detecta
          automáticamente del contenido del PDF y se muestra en el preview antes de aplicar. Elige solo quién
          paga y bajo qué modalidad (propia o referida).
        </p>
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
          Si el PDF no coincide con las columnas esperadas de esa agencia/modalidad, la subida se rechaza con
          un mensaje claro (nunca se adivina el formato). Un reporte con más de un carrier distinto en el mismo
          archivo también se rechaza — cada reporte debe representar un único carrier.
        </p>
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Subiendo…" : "Subir y previsualizar"}
      </Button>
    </form>
  );
}
