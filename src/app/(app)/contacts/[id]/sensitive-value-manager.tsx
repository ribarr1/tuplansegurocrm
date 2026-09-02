"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RevealableField } from "@/components/ui/revealable-field";
import type { SensitiveIdentityFormState } from "./sensitive-identity-actions";

interface SensitiveValueManagerProps {
  label: string;
  fieldName: string;
  placeholder: string;
  masked: string | null;
  hasValue: boolean;
  canReveal: boolean;
  onReveal: () => Promise<{ value?: string; error?: string }>;
  setAction: (state: SensitiveIdentityFormState, formData: FormData) => Promise<SensitiveIdentityFormState>;
  onRemove: () => Promise<{ error?: string }>;
}

// Fase 021 (§21-§22): editar NUNCA precarga el valor completo — solo
// ofrece "Reemplazar" (input vacío) o "Eliminar" (con confirmación).
// Ver el mismo principio para PersonImmigrationDocument.documentNumber
// en immigration-document-dialog.tsx.
export function SensitiveValueManager({
  label,
  fieldName,
  placeholder,
  masked,
  hasValue,
  canReveal,
  onReveal,
  setAction,
  onRemove,
}: SensitiveValueManagerProps) {
  const [replacing, setReplacing] = useState(false);
  const [state, formAction, isPending] = useActionState(setAction, undefined);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRemoving, startRemoveTransition] = useTransition();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) setReplacing(false);
    wasPending.current = isPending;
  }, [isPending, state]);

  function handleRemove() {
    if (!confirm(`¿Eliminar el ${label} registrado? Esta acción no se puede deshacer.`)) return;
    setRemoveError(null);
    startRemoveTransition(async () => {
      const result = await onRemove();
      if (result.error) setRemoveError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {!replacing ? (
        <div className="flex flex-wrap items-center gap-3">
          <RevealableField masked={masked} hasValue={hasValue} canReveal={canReveal} onReveal={onReveal} />
          {canReveal && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
                {hasValue ? `Reemplazar ${label}` : `Registrar ${label}`}
              </Button>
              {hasValue && (
                <Button type="button" variant="ghost" size="sm" onClick={handleRemove} disabled={isRemoving}>
                  Eliminar
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <Input name={fieldName} placeholder={placeholder} autoComplete="off" className="w-48" required />
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>
            Cancelar
          </Button>
        </form>
      )}
      {state?.fieldErrors?.[fieldName] && (
        <p className="text-xs text-destructive">{state.fieldErrors[fieldName]}</p>
      )}
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      {removeError && <p className="text-xs text-destructive">{removeError}</p>}
    </div>
  );
}
