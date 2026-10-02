import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listLeads } from "@/services/leads.service";
import { listActiveAgents } from "@/services/users.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LEAD_SOURCE_VALUES,
  LEAD_STAGE_VALUES,
  LEAD_FOLLOW_UP_STATUS_VALUES,
  UNASSIGNED_LEAD_FILTER,
} from "@/schemas/lead.schema";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_FOLLOW_UP_STATUS_LABELS,
  LEAD_FOLLOW_UP_STATUS_BADGE_VARIANT,
} from "@/lib/labels";
import { formatDateTimeUS } from "@/lib/business-time";

type SearchParams = {
  q?: string;
  source?: string;
  campaignId?: string;
  stage?: string;
  followUpStatus?: string;
  assignedToId?: string;
  receivedFrom?: string;
  receivedTo?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.source) params.set("source", merged.source);
  if (merged.campaignId) params.set("campaignId", merged.campaignId);
  if (merged.stage) params.set("stage", merged.stage);
  if (merged.followUpStatus) params.set("followUpStatus", merged.followUpStatus);
  if (merged.assignedToId) params.set("assignedToId", merged.assignedToId);
  if (merged.receivedFrom) params.set("receivedFrom", merged.receivedFrom);
  if (merged.receivedTo) params.set("receivedTo", merged.receivedTo);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

const MATCH_HINT_LABEL: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  LINKED: { label: "Contacto vinculado", variant: "secondary" },
  SINGLE: { label: "Posible coincidencia", variant: "outline" },
  AMBIGUOUS: { label: "Coincidencia ambigua", variant: "destructive" },
  NONE: { label: "Sin coincidencia", variant: "outline" },
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;

  const [{ items, total, pageSize }, assignableAgents] = await Promise.all([
    listLeads(actor, {
      search: sp.q,
      source: sp.source,
      campaignId: sp.campaignId,
      stage: sp.stage,
      followUpStatus: sp.followUpStatus,
      assignedToId: sp.assignedToId,
      receivedFrom: sp.receivedFrom,
      receivedTo: sp.receivedTo,
      page,
    }),
    actor.role === "ADMIN" ? listActiveAgents(actor) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Leads</h2>
        {actor.role === "ADMIN" && (
          <Button nativeButton={false} render={<Link href="/leads/new" />}>
            + Nuevo lead
          </Button>
        )}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input key={sp.q ?? ""} id="q" name="q" placeholder="Nombre, teléfono, correo" defaultValue={sp.q ?? ""} className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="source">Fuente</Label>
          <select id="source" name="source" defaultValue={sp.source ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>
            {LEAD_SOURCE_VALUES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="campaignId">Campaña</Label>
          <Input key={sp.campaignId ?? ""} id="campaignId" name="campaignId" defaultValue={sp.campaignId ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="stage">Etapa</Label>
          <select id="stage" name="stage" defaultValue={sp.stage ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>
            {LEAD_STAGE_VALUES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="followUpStatus">Estado</Label>
          <select id="followUpStatus" name="followUpStatus" defaultValue={sp.followUpStatus ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos</option>
            {LEAD_FOLLOW_UP_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {LEAD_FOLLOW_UP_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {actor.role === "ADMIN" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignedToId">Agente</Label>
            <select id="assignedToId" name="assignedToId" defaultValue={sp.assignedToId ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Todos</option>
              <option value={UNASSIGNED_LEAD_FILTER}>Sin asignar</option>
              {assignableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="receivedFrom">Desde</Label>
          <Input key={sp.receivedFrom ?? ""} id="receivedFrom" name="receivedFrom" type="date" defaultValue={sp.receivedFrom ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="receivedTo">Hasta</Label>
          <Input key={sp.receivedTo ?? ""} id="receivedTo" name="receivedTo" type="date" defaultValue={sp.receivedTo ?? ""} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.q || sp.source || sp.campaignId || sp.stage || sp.followUpStatus || sp.assignedToId || sp.receivedFrom || sp.receivedTo) && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/leads" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay leads con esos filtros.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Fuente / Campaña</TableHead>
                  <TableHead>Interés / Estado</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead>Recibido</TableHead>
                  <TableHead>Coincidencia</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((lead) => {
                  const hint = MATCH_HINT_LABEL[lead.personMatchHint];
                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.fullName}</TableCell>
                      <TableCell>{lead.phone}</TableCell>
                      <TableCell>
                        {LEAD_SOURCE_LABELS[lead.source]}
                        {lead.campaignName ? ` — ${lead.campaignName}` : ""}
                      </TableCell>
                      <TableCell>{[lead.productInterest, lead.residenceState].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell>{LEAD_STAGE_LABELS[lead.stage]}</TableCell>
                      <TableCell>
                        <Badge variant={LEAD_FOLLOW_UP_STATUS_BADGE_VARIANT[lead.followUpStatus]}>
                          {LEAD_FOLLOW_UP_STATUS_LABELS[lead.followUpStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>{lead.assignedTo?.name ?? "Sin asignar"}</TableCell>
                      <TableCell>{formatDateTimeUS(lead.receivedAt)}</TableCell>
                      <TableCell>
                        {hint && <Badge variant={hint.variant}>{hint.label}</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/leads/${lead.id}`} />}>
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm">
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                Anterior
              </Button>
            ) : (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={buildHref(sp, { page: String(page - 1) })} />}>
                Anterior
              </Button>
            )}
            <span className="text-muted-foreground">
              Página {page} de {totalPages}
            </span>
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                Siguiente
              </Button>
            ) : (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={buildHref(sp, { page: String(page + 1) })} />}>
                Siguiente
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
