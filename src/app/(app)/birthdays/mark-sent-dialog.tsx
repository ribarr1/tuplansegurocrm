"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BIRTHDAY_GREETING_CHANNEL_VALUES } from "@/schemas/birthday.schema";
import { BIRTHDAY_GREETING_CHANNEL_LABELS } from "@/lib/labels";
import { markBirthdaySentAction } from "./actions";

// "Marcar como enviada" NUNCA envía el mensaje — solo registra que el
// agente ya lo hizo por fuera del CRM (WhatsApp/SMS/email reales quedan
// para una integración futura, ver docs/DECISIONS.md).
export function MarkSentDialog({ personId, personName }: { personId: string; personName: string }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<string>("WHATSAPP");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await markBirthdaySentAction(personId, channel);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(undefined);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Marcar enviada</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar felicitación como enviada</DialogTitle>
          <DialogDescription>
            {personName} — esto solo registra que ya enviaste la felicitación por fuera del
            CRM. No se envía ningún mensaje desde aquí.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="channel" className="text-sm font-medium">
            Canal
          </label>
          <select
            id="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {BIRTHDAY_GREETING_CHANNEL_VALUES.map((c) => (
              <option key={c} value={c}>
                {BIRTHDAY_GREETING_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button type="button" disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Guardando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
