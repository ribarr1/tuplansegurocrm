"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { retryWebhookEventAction } from "./actions";

// `receivedAtLabel` llega PRE-FORMATEADO desde el Server Component
// (page.tsx) — este archivo es "use client" y `@/lib/business-time`
// tiene `import "server-only"`, así que nunca puede importarse aquí
// (rompería el bundle del cliente).
type FailedEvent = {
  id: string;
  source: string;
  externalEventId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAtLabel: string;
  integrationCredential: { label: string };
};

export function FailedWebhookEvents({ events }: { events: FailedEvent[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function handleRetry(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await retryWebhookEventAction(id);
      setPendingId(null);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        setRetried((prev) => new Set(prev).add(id));
      }
    });
  }

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin eventos fallidos pendientes de revisión.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">{event.integrationCredential.label}</span> ({event.source}) —{" "}
              {event.receivedAtLabel}
            </div>
            <Badge variant={event.status === "DEAD_LETTER" ? "destructive" : "outline"}>{event.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            ID externo: {event.externalEventId} · Intentos: {event.attempts}
          </p>
          {event.lastError && <p className="mt-1 text-xs text-destructive">{event.lastError}</p>}
          {retried.has(event.id) ? (
            <p className="mt-2 text-xs text-emerald-600">Reencolado para reintento.</p>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={pendingId === event.id}
              onClick={() => handleRetry(event.id)}
            >
              {pendingId === event.id ? "Reintentando…" : "Reintentar"}
            </Button>
          )}
          {errors[event.id] && <p className="mt-1 text-xs text-destructive">{errors[event.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
