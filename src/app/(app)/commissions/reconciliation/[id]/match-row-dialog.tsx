"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateOnlyUS } from "@/lib/date-only";
import { manualMatchRowAction, searchPolicyCandidatesForRowAction } from "../actions";
import type { PolicyCandidate } from "@/services/commission-statements/policy-candidates";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activa",
  PENDING: "Pendiente",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};

const BUSINESS_SOURCE_LABELS: Record<string, string> = {
  OWN: "Propia",
  REFERRAL: "Referida",
  UNKNOWN: "Desconocida",
};

const PAYER_AGENCY_LABELS: Record<string, string> = { ORANGE: "Orange", ELITE: "Elite" };
const BUSINESS_MODALITY_LABELS: Record<string, string> = { OWN: "Propias", REFERRAL: "Referidas" };

// formatPeriodUS (business-time.ts) es "server-only" — este es un
// Client Component, así que se reimplementa el mismo formato MM/YYYY
// en UTC aquí (la columna de período ya está anclada a medianoche
// UTC, ver reconciliation.service.ts).
function formatPeriodMMYYYY(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

// Fase 025.5.6 (UAT-22) — contexto de la fila que se muestra en el
// encabezado de la ventana, para que el ADMIN nunca pierda de vista QUÉ
// está emparejando mientras revisa candidatas.
export type MatchDialogRowContext = {
  displayName: string | null;
  carrier: string | null;
  state: string | null;
  commissionPeriod: string | null; // ISO date, ya serializado por el server component
  payerAgency: string | null;
  businessModality: string | null;
  receivedAmount: string;
};

export function MatchRowDialog({
  rowId,
  rowLabel,
  rowContext,
  triggerLabel = "Emparejar",
}: {
  rowId: string;
  rowLabel: string;
  rowContext: MatchDialogRowContext;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PolicyCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [outOfPeriodReason, setOutOfPeriodReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const selected = candidates.find((c) => c.policyId === selectedId) ?? null;
  const period = rowContext.commissionPeriod ? new Date(rowContext.commissionPeriod) : null;
  const needsOutOfPeriodReason = !!selected && selected.periodMatch !== "MATCH";
  const needsMember = !!selected && selected.policyMembers !== null;
  const selectedMemberDuplicate =
    needsMember && selectedMemberId
      ? (selected!.policyMembers!.find((m) => m.id === selectedMemberId)?.possibleDuplicate ?? false)
      : false;

  function handleSearch(value: string) {
    setQuery(value);
    setSelectedId(null);
    setSelectedMemberId(null);
    startTransition(async () => {
      const results = await searchPolicyCandidatesForRowAction(rowId, value);
      setCandidates(results);
    });
  }

  function handleConfirm() {
    if (!selectedId) return;
    if (needsOutOfPeriodReason && outOfPeriodReason.trim().length < 3) {
      setError("Escribe un motivo breve para emparejar una póliza fuera del periodo.");
      return;
    }
    if (needsMember && !selectedMemberId) {
      setError("Selecciona el miembro cubierto por esta póliza.");
      return;
    }
    startTransition(async () => {
      const result = await manualMatchRowAction(rowId, {
        policyId: selectedId,
        policyMemberId: selectedMemberId,
        outOfPeriodReason: needsOutOfPeriodReason ? outOfPeriodReason.trim() : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  const recommended = candidates.filter((c) => c.recommended);
  const others = candidates.filter((c) => !c.recommended);

  function CandidateCard({ c }: { c: PolicyCandidate }) {
    const isSelected = selectedId === c.policyId;
    return (
      <label
        className={`flex flex-col gap-1 rounded-md border p-3 text-sm ${isSelected ? "border-primary bg-secondary/40" : ""}`}
      >
        <div className="flex items-start gap-2">
          <input
            type="radio"
            name="candidate"
            className="mt-1"
            checked={isSelected}
            onChange={() => {
              setSelectedId(c.policyId);
              setSelectedMemberId(null);
              setError(undefined);
            }}
          />
          <div className="flex-1">
            <div className="font-medium">{c.holderName}</div>
            <div className="text-xs text-muted-foreground">
              {c.carrierName} · {c.productName} · {c.planYear ? `Plan ${c.planYear}` : "Año no definido"}
            </div>
            <div className="text-xs text-muted-foreground">
              {STATUS_LABELS[c.status] ?? c.status} · {BUSINESS_SOURCE_LABELS[c.businessSource] ?? c.businessSource}
            </div>
            <div className="text-xs text-muted-foreground">
              Vigencia: {c.effectiveDate ? formatDateOnlyUS(new Date(c.effectiveDate)) : "—"} –{" "}
              {c.terminationDate ? formatDateOnlyUS(new Date(c.terminationDate)) : "sin fecha de baja"}
              {c.maskedPolicyNumber && ` · Póliza: ${c.maskedPolicyNumber}`}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.periodMatch === "MATCH" && <Badge variant="default">Coincide con el periodo</Badge>}
              {c.periodMatch === "OUT_OF_PERIOD" && <Badge variant="destructive">Fuera del periodo</Badge>}
              {c.periodMatch === "INCOMPLETE" && <Badge variant="outline">Vigencia incompleta</Badge>}
              {!c.modalityMatches && <Badge variant="destructive">Modalidad no coincide</Badge>}
              {c.businessSource === "UNKNOWN" && <Badge variant="outline">Clasificación sin definir</Badge>}
              {!c.policyTypeMatches && <Badge variant="destructive">No es HEALTH</Badge>}
            </div>
          </div>
        </div>

        {isSelected && needsMember && (
          <div className="ml-6 mt-2 flex flex-col gap-1 border-l pl-3">
            <p className="text-xs font-medium text-muted-foreground">
              Orange Referidas paga por miembro — selecciona el miembro cubierto:
            </p>
            {c.policyMembers!.length === 0 && (
              <p className="text-xs text-destructive">Esta póliza no tiene miembros registrados.</p>
            )}
            {c.policyMembers!.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="member"
                  checked={selectedMemberId === m.id}
                  onChange={() => setSelectedMemberId(m.id)}
                />
                <span>
                  {m.displayName} <span className="text-muted-foreground">({m.role})</span>
                  {m.possibleDuplicate && (
                    <Badge variant="destructive" className="ml-2">
                      Posible duplicado
                    </Badge>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </label>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setCandidates([]);
          setSelectedId(null);
          setSelectedMemberId(null);
          setOutOfPeriodReason("");
          setError(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Emparejar comisión
            {period && ` · ${formatPeriodMMYYYY(period)}`}
            {rowContext.payerAgency &&
              ` · ${PAYER_AGENCY_LABELS[rowContext.payerAgency] ?? rowContext.payerAgency}${
                rowContext.businessModality
                  ? ` — ${BUSINESS_MODALITY_LABELS[rowContext.businessModality] ?? rowContext.businessModality}`
                  : ""
              }`}
          </DialogTitle>
          <DialogDescription>
            {rowLabel}
            {rowContext.carrier && ` · Carrier: ${rowContext.carrier}`}
            {rowContext.state && ` · ${rowContext.state}`} · Subtotal: ${rowContext.receivedAmount}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <input
            type="text"
            placeholder="Buscar por nombre, número de póliza o miembro"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {recommended.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-muted-foreground">Recomendadas</p>
                {recommended.map((c) => (
                  <CandidateCard key={c.policyId} c={c} />
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  {recommended.length > 0 ? "Otras pólizas de la persona" : "Resultados"}
                </p>
                {others.map((c) => (
                  <CandidateCard key={c.policyId} c={c} />
                ))}
              </div>
            )}
            {query.length >= 2 && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin resultados.</p>
            )}
          </div>

          {needsOutOfPeriodReason && (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2">
              <p className="text-xs text-destructive">
                La póliza seleccionada no cubre el periodo de comisión
                {period ? ` ${formatPeriodMMYYYY(period)}` : ""}. Escribe un motivo para continuar.
              </p>
              <textarea
                value={outOfPeriodReason}
                onChange={(e) => setOutOfPeriodReason(e.target.value)}
                placeholder="Motivo administrativo (ej. pago atrasado del carrier, corrección de un error anterior...)"
                className="min-h-16 rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
            </div>
          )}

          {selected && selectedMemberDuplicate && (
            <p className="text-xs text-destructive">
              Este miembro ya está vinculado a otra fila del mismo periodo — revisa antes de continuar.
            </p>
          )}

          {selected && (
            <div className="rounded-md border bg-secondary/20 p-2 text-xs">
              <p className="font-medium">Resumen</p>
              <p>Póliza: {selected.holderName} — {selected.carrierName} · {selected.productName}</p>
              <p>Año: {selected.planYear ?? "no definido"} · Clasificación: {BUSINESS_SOURCE_LABELS[selected.businessSource] ?? selected.businessSource}</p>
              {needsMember && selectedMemberId && (
                <p>Miembro: {selected.policyMembers!.find((m) => m.id === selectedMemberId)?.displayName}</p>
              )}
              {selected.warnings.length > 0 && (
                <p className="mt-1 text-amber-600 dark:text-amber-400">{selected.warnings.join(" ")}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={!selectedId || isPending} onClick={handleConfirm}>
            {isPending ? "Guardando…" : "Confirmar emparejamiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
