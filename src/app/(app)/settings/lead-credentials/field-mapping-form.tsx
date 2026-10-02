"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setCustomFieldMappingAction } from "./actions";

// Mapeo de preguntas PERSONALIZADAS del formulario (§6, Preparación
// para producción) — NUNCA un secreto, NUNCA mezclado con el
// formulario de connectorSecrets (ver connector-config-form.tsx).
export function FieldMappingForm({
  credentialId,
  source,
  currentMapping,
}: {
  credentialId: string;
  source: "GOOGLE" | "META";
  currentMapping: { residenceStateFieldKey?: string; productInterestFieldKey?: string } | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await setCustomFieldMappingAction(credentialId, formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(true);
        setIsOpen(false);
      }
    });
  }

  const fieldKeyLabel = source === "GOOGLE" ? "column_id o nombre de la pregunta" : "nombre del campo (field_data.name)";

  if (!isOpen) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(true)}>
          {currentMapping ? "Editar mapeo de preguntas" : "Mapear preguntas personalizadas"}
        </Button>
        {success && <p className="text-xs text-emerald-600">Guardado.</p>}
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-2 rounded-md border p-3 text-left">
      <p className="text-xs text-muted-foreground">
        Opcional — {fieldKeyLabel}. Déjalo vacío si esta integración no tiene esa pregunta en el formulario; nunca se
        inventa un valor para un campo no mapeado (sigue visible en &quot;Respuestas del formulario&quot;).
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`residenceStateFieldKey-${credentialId}`}>Estado de residencia</Label>
        <Input
          id={`residenceStateFieldKey-${credentialId}`}
          name="residenceStateFieldKey"
          defaultValue={currentMapping?.residenceStateFieldKey ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`productInterestFieldKey-${credentialId}`}>Producto de interés</Label>
        <Input
          id={`productInterestFieldKey-${credentialId}`}
          name="productInterestFieldKey"
          defaultValue={currentMapping?.productInterestFieldKey ?? ""}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
