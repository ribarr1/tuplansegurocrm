"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POLICY_DOCUMENT_TYPE_VALUES } from "@/schemas/policy-document.schema";
import { POLICY_DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { uploadPolicyDocumentAction, type DocumentFormState } from "./documents-actions";

export function UploadDocumentForm({ policyId }: { policyId: string }) {
  const action = uploadPolicyDocumentAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState<DocumentFormState, FormData>(action, undefined);
  const [prevState, setPrevState] = useState(state);
  const [resetCount, setResetCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (!state?.error) setResetCount((c) => c + 1);
  }

  return (
    <form key={resetCount} action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      {state?.error && (
        <p className="w-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
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
