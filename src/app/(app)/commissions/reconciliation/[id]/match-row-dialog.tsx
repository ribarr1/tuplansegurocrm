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
import { manualMatchRowAction, searchPoliciesForManualMatchAction } from "../actions";

type PolicyCandidate = {
  id: string;
  policyNumber: string | null;
  holder: { firstName: string; lastName: string };
  product: { carrier: { name: string } };
};

export function MatchRowDialog({ rowId, rowLabel }: { rowId: string; rowLabel: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PolicyCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    setQuery(value);
    startTransition(async () => {
      const results = await searchPoliciesForManualMatchAction(value);
      setCandidates(results as PolicyCandidate[]);
    });
  }

  function handleConfirm() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await manualMatchRowAction(rowId, selectedId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Emparejar</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Emparejar fila con una póliza</DialogTitle>
          <DialogDescription>{rowLabel}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <input
            type="text"
            placeholder="Buscar por nombre o número de póliza"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {candidates.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/40"
              >
                <input
                  type="radio"
                  name="candidate"
                  checked={selectedId === c.id}
                  onChange={() => setSelectedId(c.id)}
                />
                <span className="flex-1">
                  {c.holder.firstName} {c.holder.lastName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.product.carrier.name}
                    {c.policyNumber ? ` · ${c.policyNumber}` : ""}
                  </span>
                </span>
              </label>
            ))}
            {query.length >= 2 && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin resultados.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" disabled={!selectedId || isPending} onClick={handleConfirm}>
            {isPending ? "Guardando…" : "Confirmar match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
