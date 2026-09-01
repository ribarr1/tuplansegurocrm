"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess } from "@/components/ui/form-feedback";
import { POLICY_DOCUMENT_TYPE_VALUES } from "@/schemas/policy-document.schema";
import { POLICY_DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { uploadPolicyDocumentAction, type DocumentFormState } from "./documents-actions";

export function UploadDocumentForm({ policyId }: { policyId: string }) {
  const action = uploadPolicyDocumentAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState<DocumentFormState, FormData>(action, undefined);
  // Remonta (limpia el <input type="file">, que no puede controlarse
  // con `value`) SOLO tras un éxito real — antes de agregar
  // success:true a DocumentFormState, un éxito devolvía `undefined`
  // igual que el estado inicial, así que la comparación de abajo nunca
  // detectaba el cambio y el archivo subido seguía mostrándose en el
  // input tras un upload exitoso.
  const [prevState, setPrevState] = useState(state);
  const [resetCount, setResetCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setResetCount((c) => c + 1);
  }

  return (
    <form key={resetCount} action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      <FormError message={state?.error} />
      {state?.success && <FormSuccess message="Documento subido correctamente." />}
      <div className="flex flex-col gap-1">
        <Label htmlFor="doc-type">Tipo</Label>
        <select
          id="doc-type"
          name="type"
          defaultValue="OTHER"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {POLICY_DOCUMENT_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {POLICY_DOCUMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="doc-description">Descripción (opcional)</Label>
        <Input id="doc-description" name="description" className="w-48" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="doc-file">Archivo (PDF, PNG, JPG, WEBP — máx. 15 MB)</Label>
        <input
          id="doc-file"
          name="file"
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Subiendo…" : "Subir documento"}
      </Button>
    </form>
  );
}
