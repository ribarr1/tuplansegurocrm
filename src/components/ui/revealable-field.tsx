"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

interface RevealableFieldProps {
  masked: string | null;
  hasValue: boolean;
  canReveal: boolean;
  onReveal: () => Promise<{ value?: string; error?: string }>;
}

// Fase 021 (§12-§13, §17-§19): el valor completo NUNCA llega al
// navegador hasta que el usuario pulsa "Mostrar" — este componente
// solo recibe el valor enmascarado por props; el completo se pide bajo
// demanda vía una Server Action (nunca cacheable) y vive SOLO en
// estado de React, nunca persistido — recargar, navegar o desmontar
// este componente vuelve a mostrar el valor enmascarado.
export function RevealableField({ masked, hasValue, canReveal, onReveal }: RevealableFieldProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!hasValue) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  function handleReveal() {
    setError(null);
    startTransition(async () => {
      const result = await onReveal();
      if (result.error) {
        setError(result.error);
        return;
      }
      setRevealed(result.value ?? null);
    });
  }

  function handleHide() {
    setRevealed(null);
    setCopied(false);
    setError(null);
  }

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar. Copia manualmente.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{revealed ?? masked}</span>
        {revealed ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleHide}>
              Ocultar
            </Button>
          </>
        ) : canReveal ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleReveal} disabled={isPending}>
            {isPending ? "Mostrando…" : "Mostrar"}
          </Button>
        ) : null}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
