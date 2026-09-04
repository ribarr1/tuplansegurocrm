"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

// createdAtDisplay llega YA formateado desde el servidor (MM/DD/AAAA,
// hora) — business-time.ts depende de "server-only" (lee
// APP_TIME_ZONE de process.env, no disponible en el bundle de
// cliente), así que nunca se formatea aquí. Ver history-tab.tsx /
// history-section.tsx / history-actions.ts, que formatean antes de
// pasar los eventos a este componente.
export type HistoryEventDTO = {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  changes: unknown;
  actorType: "USER" | "SYSTEM";
  createdAtDisplay: string;
  actor: { id: string; name: string } | null;
};

export type HistoryPageDTO = { events: HistoryEventDTO[]; nextCursor: string | null };

// Etiquetas legibles para los campos que sí llegan a `changes` — nunca
// se muestra el nombre técnico crudo del campo (§17 de UAT: "No mostrar
// JSON crudo"). Un campo sin entrada aquí cae de vuelta al nombre tal
// cual, mejor que ocultarlo.
const FIELD_LABELS: Record<string, string> = {
  firstName: "Nombre",
  middleName: "Segundo nombre",
  lastName: "Apellido",
  secondLastName: "Segundo apellido",
  preferredName: "Nombre preferido",
  dateOfBirth: "Fecha de nacimiento",
  email: "Email",
  phone: "Teléfono",
  contactStatus: "Estado del contacto",
  source: "Fuente",
  assignedAgentId: "Agente asignado",
  addressLine1: "Dirección",
  addressLine2: "Dirección (línea 2)",
  city: "Ciudad",
  state: "Estado (US)",
  zipCode: "ZIP",
  county: "Condado",
  annualHouseholdIncome: "Ingreso familiar",
  incomeYear: "Año del ingreso",
  role: "Rol",
  policyNumber: "Número de póliza",
  status: "Estado",
  effectiveDate: "Fecha efectiva",
  terminationDate: "Fecha de terminación",
  premiumAmount: "Prima",
  billingFrequency: "Frecuencia de pago",
  nextPaymentDueDate: "Próximo pago",
  paymentManagementMode: "Modalidad de gestión de pago",
  autopay: "Autopay",
  needsPaymentAssistance: "Necesita asistencia para pagar",
  paymentStatus: "Estado de pago",
  operationType: "Tipo de operación",
  healthCoverageSource: "Tipo de cobertura",
  productId: "Producto",
  title: "Título",
  priority: "Prioridad",
  dueAt: "Vencimiento",
  assignedToId: "Responsable",
  marketplaceApplicationId: "Application ID",
  marketplaceState: "Estado de Marketplace",
  planNameSnapshot: "Nombre del plan",
  deductibleIndividual: "Deducible individual",
  deductibleFamily: "Deducible familiar",
  outOfPocketIndividual: "OOP individual",
  outOfPocketFamily: "OOP familiar",
  agentId: "Agente",
  period: "Período",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

export function HistoryTimeline({
  initialEvents,
  initialCursor,
  loadMore,
  emptyMessage = "Sin eventos registrados todavía.",
}: {
  initialEvents: HistoryEventDTO[];
  initialCursor: string | null;
  loadMore: (cursor: string | null) => Promise<HistoryPageDTO>;
  emptyMessage?: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {events.map((event) => {
        const changes = event.changes as Record<string, { before: unknown; after: unknown }> | null;
        const changeEntries = changes ? Object.entries(changes) : [];
        return (
          <div key={event.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{event.summary}</span>
              <span className="text-xs text-muted-foreground">{event.createdAtDisplay}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              por {event.actorType === "SYSTEM" ? "Sistema" : (event.actor?.name ?? "Usuario eliminado")}
            </span>
            {changeEntries.length > 0 && (
              <div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => toggleExpanded(event.id)}
                >
                  {expanded.has(event.id) ? "Ocultar cambios" : "Ver cambios"}
                </button>
                {expanded.has(event.id) && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pr-3 font-normal">Campo</th>
                          <th className="pr-3 font-normal">Antes</th>
                          <th className="font-normal">Después</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changeEntries.map(([field, { before, after }]) => (
                          <tr key={field}>
                            <td className="pr-3 py-0.5 text-muted-foreground">{fieldLabel(field)}</td>
                            <td className="pr-3 py-0.5">{formatChangeValue(before)}</td>
                            <td className="py-0.5">{formatChangeValue(after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {cursor && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const page = await loadMore(cursor);
              setEvents((prev) => [...prev, ...page.events]);
              setCursor(page.nextCursor);
            });
          }}
        >
          {isPending ? "Cargando…" : "Mostrar más"}
        </Button>
      )}
    </div>
  );
}
