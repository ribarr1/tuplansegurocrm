"use client";

import { useState, useTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  MANUAL_FOLLOW_UP_STATUS_VALUES,
  LEAD_CLOSE_REASON_VALUES,
} from "@/schemas/lead.schema";
import { LEAD_FOLLOW_UP_STATUS_LABELS, LEAD_CLOSE_REASON_LABELS } from "@/lib/labels";
import { markAsProspectAction, updateFollowUpStatusAction, closeLeadAction } from "./actions";
import type { CloseLeadFormState } from "./form-helpers";

export function LeadStatusActions({
  leadId,
  stage,
  followUpStatus,
}: {
  leadId: string;
  stage: "LEAD" | "PROSPECT" | "CLIENT";
  followUpStatus: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [closeState, closeFormAction, isClosePending] = useActionState<CloseLeadFormState, FormData>(
    (prev, formData) => closeLeadAction(leadId, prev, formData),
    undefined
  );

  const isTerminal = followUpStatus === "CONVERTED" || followUpStatus === "CLOSED";

  function handleFollowUpChange(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateFollowUpStatusAction(leadId, value);
      if (result.error) setError(result.error);
    });
  }

  function handleMarkAsProspect() {
    setError(null);
    startTransition(async () => {
      const result = await markAsProspectAction(leadId);
      if (result.error) setError(result.error);
    });
  }

  if (isTerminal) {
    return <p className="text-sm text-muted-foreground">Este lead está en un estado final.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {stage === "LEAD" && (
          <Button type="button" size="sm" variant="secondary" onClick={handleMarkAsProspect} disabled={isPending}>
            Confirmar interés (pasar a Prospecto)
          </Button>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="followUpStatus">Estado de seguimiento</Label>
          <select
            id="followUpStatus"
            defaultValue={followUpStatus}
            disabled={isPending}
            onChange={(e) => handleFollowUpChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {MANUAL_FOLLOW_UP_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {LEAD_FOLLOW_UP_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <form action={closeFormAction} className="flex flex-wrap items-end gap-3 border-t pt-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="closeReason">Cerrar lead — motivo</Label>
          <select
            id="closeReason"
            name="closeReason"
            defaultValue=""
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>
              Selecciona un motivo
            </option>
            {LEAD_CLOSE_REASON_VALUES.map((r) => (
              <option key={r} value={r}>
                {LEAD_CLOSE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
          {closeState?.fieldErrors?.closeReason && (
            <p className="text-sm text-destructive">{closeState.fieldErrors.closeReason}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="closeReasonDetail">Detalle (requerido si es Otro)</Label>
          <input
            id="closeReasonDetail"
            name="closeReasonDetail"
            className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
          />
          {closeState?.fieldErrors?.closeReasonDetail && (
            <p className="text-sm text-destructive">{closeState.fieldErrors.closeReasonDetail}</p>
          )}
        </div>
        <Button type="submit" variant="destructive" size="sm" disabled={isClosePending}>
          {isClosePending ? "Cerrando…" : "Cerrar lead"}
        </Button>
        {closeState?.error && <p className="text-sm text-destructive">{closeState.error}</p>}
      </form>
    </div>
  );
}
