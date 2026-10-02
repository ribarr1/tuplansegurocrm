"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLeadCredentialAction, type CreateCredentialState } from "./actions";

// Fuentes de INTEGRACIÓN — MANUAL se excluye (no es una integración
// externa, ver lead-credentials.service.ts).
const INTEGRATION_SOURCES = ["GOOGLE", "META", "WEB", "OTHER"] as const;

export function CredentialForm() {
  const [state, formAction, isPending] = useActionState<CreateCredentialState, FormData>(
    createLeadCredentialAction,
    undefined
  );
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!state?.created) return;
    try {
      await navigator.clipboard.writeText(state.created.authorizationHeaderValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin clipboard disponible: el valor sigue visible para copiar a mano.
    }
  }

  if (state?.created) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-amber-400/60 bg-amber-50/50 p-4 dark:bg-amber-950/20">
        <p className="text-sm font-medium">
          Credencial &quot;{state.created.label}&quot; creada. Copia este valor ahora — no se puede volver a mostrar.
        </p>
        <div className="flex items-center gap-2">
          <code className="break-all rounded-md bg-background px-3 py-2 text-xs">
            {state.created.authorizationHeaderValue}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Úsalo como header: <code>Authorization: {state.created.authorizationHeaderValue}</code>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border p-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="label">Etiqueta</Label>
        <Input id="label" name="label" placeholder="Ej. Formulario web TuPlanSeguro" required />
        {state?.fieldErrors?.label && <p className="text-sm text-destructive">{state.fieldErrors.label}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="source">Fuente</Label>
        <select id="source" name="source" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          {INTEGRATION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.source && <p className="text-sm text-destructive">{state.fieldErrors.source}</p>}
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creando…" : "Crear credencial"}
      </Button>
    </form>
  );
}
