"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FieldError } from "@/components/ui/form-feedback";
import { USDateInput } from "@/components/ui/us-date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { IMMIGRATION_DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { IMMIGRATION_DOCUMENT_TYPE_VALUES } from "@/schemas/sensitive-identity.schema";
import { createImmigrationDocumentAction, updateImmigrationDocumentAction } from "./sensitive-identity-actions";

export type ImmigrationDocumentRecord = {
  id: string;
  documentType: (typeof IMMIGRATION_DOCUMENT_TYPE_VALUES)[number];
  hasDocumentNumber: boolean;
  issuedDate: string | null;
  expirationDate: string | null;
};

// Fase 021 (§4-§5, §21, §23): un solo diálogo para crear/editar, mismo
// patrón que MedicationDialog. issuedDate/expirationDate usan
// USDateInput (MM/DD/AAAA), ninguno es obligatorio. El número de
// documento NUNCA se precarga al editar — "Reemplazar número" abre un
// input vacío; si no se toca, el número existente no se toca.
export function ImmigrationDocumentDialog({
  personId,
  document,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "sm",
}: {
  personId: string;
  document?: ImmigrationDocumentRecord;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [replacingNumber, setReplacingNumber] = useState(!document);
  const action = document
    ? updateImmigrationDocumentAction.bind(null, document.id, personId)
    : createImmigrationDocumentAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) {
      setOpen(false);
      setReplacingNumber(!document);
    }
    wasPending.current = isPending;
  }, [isPending, state, document]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{document ? "Editar documento migratorio" : "Agregar documento migratorio"}</DialogTitle>
          <DialogDescription>
            El número se guarda cifrado y solo se muestra bajo demanda con &quot;Mostrar&quot;.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <FormError message={state?.error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-type">Tipo de documento</Label>
            <select
              id="doc-type"
              name="documentType"
              defaultValue={document?.documentType ?? "PERMANENT_RESIDENT_CARD"}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {IMMIGRATION_DOCUMENT_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {IMMIGRATION_DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <FieldError message={state?.fieldErrors?.documentType} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-number">Número de documento</Label>
            {document && !replacingNumber ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {document.hasDocumentNumber ? "Sin cambios (permanece cifrado)" : "Sin número registrado"}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setReplacingNumber(true)}>
                  Reemplazar
                </Button>
              </div>
            ) : (
              <Input
                id="doc-number"
                name="documentNumber"
                autoComplete="off"
                placeholder="Ej. RC9876"
                required={!document}
              />
            )}
            <FieldError message={state?.fieldErrors?.documentNumber} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-issued">Fecha de emisión (opcional)</Label>
            <USDateInput id="doc-issued" name="issuedDate" defaultValue={document?.issuedDate ?? ""} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="doc-expiration">Fecha de vencimiento (opcional)</Label>
            <USDateInput id="doc-expiration" name="expirationDate" defaultValue={document?.expirationDate ?? ""} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : document ? "Guardar cambios" : "Agregar documento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
