"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

interface RevealableCredentialFieldProps {
  masked: string;
  canReveal: boolean;
  onReveal: () => Promise<{ value?: string; error?: string }>;
  // Fase 025 (Parte J): a diferencia de RevealableField (Fase 021), el
  // vault de credenciales debe auditar la COPIA por separado de la
  // revelación (CREDENTIAL_*_COPIED, nunca solo CREDENTIAL_*_REVEALED)
  // — este callback dispara esa auditoría; el clipboard.writeText
  // nunca espera su respuesta (no debe bloquear ni fallar la copia si
  // el audit tarda).
  onCopy: () => Promise<void>;
}

export function RevealableCredentialField({
  masked,
  canReveal,
  onReveal,
  onCopy,
}: RevealableCredentialFieldProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

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
    // Fire-and-forget: la copia real ya ocurrió del lado del cliente —
    // el audit nunca debe bloquear ni poder "fallar" la experiencia de
    // copiar.
    void onCopy();
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
