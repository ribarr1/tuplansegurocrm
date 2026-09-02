import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listClientReport } from "@/services/reports.service";
import { listActiveAgents } from "@/services/users.service";
import { listActiveCarriers } from "@/services/policies.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONTACT_STATUS_LABELS,
  CONTACT_STATUS_BADGE_VARIANT,
  IMMIGRATION_CATEGORY_LABELS,
  POLICY_TYPE_LABELS,
} from "@/lib/labels";
import { CONTACT_STATUS_VALUES } from "@/schemas/person.schema";
import { IMMIGRATION_CATEGORY_VALUES } from "@/schemas/sensitive-identity.schema";
import { formatDateOnlyUS } from "@/lib/date-only";
import { formatDateTimeUS } from "@/lib/business-time";

type SearchParams = {
  q?: string;
  contactStatus?: string;
  assignedAgentId?: string;
  state?: string;
  immigrationCategory?: string;
  hasActivePolicy?: string;
  policyType?: string;
  carrierId?: string;
  paymentAssistance?: string;
  expiringSoon?: string;
  pageSize?: string;
  page?: string;
};

const POLICY_TYPE_VALUES = ["HEALTH", "LIFE", "SUPPLEMENTAL", "DENTAL", "FINAL_EXPENSE"] as const;

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value && !(key === "page" && value === "1")) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/reports/clients?${qs}` : "/reports/clients";
}

export default async function ClientReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const pageSize = [25, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 25;

  const [{ items, total }, activeAgents, activeCarriers] = await Promise.all([
    listClientReport(actor, {
      search: sp.q || undefined,
      contactStatus: sp.contactStatus || undefined,
      assignedAgentId: sp.assignedAgentId || undefined,
      state: sp.state || undefined,
      immigrationCategory: sp.immigrationCategory || undefined,
      hasActivePolicy: sp.hasActivePolicy || undefined,
      policyType: sp.policyType || undefined,
      carrierId: sp.carrierId || undefined,
      paymentAssistance: sp.paymentAssistance || undefined,
      expiringSoon: sp.expiringSoon || undefined,
      page,
      pageSize,
    }),
    actor.role === "ADMIN" || actor.role === "ASSISTANT" ? listActiveAgents(actor) : Promise.resolve([]),
    listActiveCarriers(actor),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(
    sp.q ||
      sp.contactStatus ||
      sp.assignedAgentId ||
      sp.state ||
      sp.immigrationCategory ||
      sp.hasActivePolicy ||
      sp.policyType ||
      sp.carrierId ||
      sp.paymentAssistance ||
      sp.expiringSoon
  );

  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value && key !== "page" && key !== "pageSize") exportParams.set(key, value);
  }
  const exportHref = `/api/export/client-report${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Reporte de clientes</h2>
        <Button variant="outline" nativeButton={false} render={<a href={exportHref} />}>
          Exportar CSV
        </Button>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input id="q" name="q" placeholder="Nombre, teléfono o correo" defaultValue={sp.q ?? ""} className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contactStatus">Estado</Label>
          <select
            id="contactStatus"
            name="contactStatus"
            defaultValue={sp.contactStatus ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {CONTACT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {activeAgents.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignedAgentId">Agente</Label>
            <select
              id="assignedAgentId"
              name="assignedAgentId"
              defaultValue={sp.assignedAgentId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="state">Estado (US)</Label>
          <Input id="state" name="state" placeholder="FL" maxLength={2} defaultValue={sp.state ?? ""} className="w-16" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="immigrationCategory">Categoría migratoria</Label>
          <select
            id="immigrationCategory"
            name="immigrationCategory"
            defaultValue={sp.immigrationCategory ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {IMMIGRATION_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {IMMIGRATION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo de póliza</Label>
          <select
            id="policyType"
            name="policyType"
            defaultValue={sp.policyType ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {POLICY_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {POLICY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="carrierId">Compañía</Label>
          <select
            id="carrierId"
            name="carrierId"
            defaultValue={sp.carrierId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {activeCarriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="hasActivePolicy">Con póliza activa</Label>
          <select
            id="hasActivePolicy"
            name="hasActivePolicy"
            defaultValue={sp.hasActivePolicy ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Sí</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expiringSoon">Vencen en 30 días</Label>
          <select
            id="expiringSoon"
            name="expiringSoon"
            defaultValue={sp.expiringSoon ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Sí</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pageSize">Por página</Label>
          <select
            id="pageSize"
            name="pageSize"
            defaultValue={String(pageSize)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {hasFilters && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/reports/clients" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "No encontramos clientes con esos filtros." : "No hay clientes todavía."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Categoría migratoria</TableHead>
                  <TableHead>Hogar</TableHead>
                  <TableHead>Pólizas activas</TableHead>
                  <TableHead>Compañía / Tipo</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Asistencia de pago</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((person) => {
                  const household = person.householdMembers[0]?.household;
                  const primaryPolicy = person.holderPolicies[0];
                  return (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">
                        {person.firstName} {person.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CONTACT_STATUS_BADGE_VARIANT[person.contactStatus]}>
                          {CONTACT_STATUS_LABELS[person.contactStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>{person.assignedAgent?.name ?? "Sin asignar"}</TableCell>
                      <TableCell>
                        {household ? [household.city, household.state].filter(Boolean).join(", ") || "—" : "—"}
                      </TableCell>
                      <TableCell>
                        {IMMIGRATION_CATEGORY_LABELS[person.sensitiveIdentity?.immigrationCategory ?? "UNKNOWN"]}
                      </TableCell>
                      <TableCell>{household ? `${household._count.members} miembro(s)` : "—"}</TableCell>
                      <TableCell>{person._count.holderPolicies}</TableCell>
                      <TableCell>
                        {primaryPolicy
                          ? `${primaryPolicy.product.carrier.name} — ${POLICY_TYPE_LABELS[primaryPolicy.product.policyType]}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {primaryPolicy
                          ? `${formatDateOnlyUS(primaryPolicy.effectiveDate)} – ${formatDateOnlyUS(primaryPolicy.terminationDate)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{primaryPolicy?.needsPaymentAssistance ? "Sí" : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {person.lastActivity
                          ? `${person.lastActivity.summary} — ${formatDateTimeUS(person.lastActivity.createdAt)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/contacts/${person.id}`} />}>
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
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={buildHref(sp, { page: String(page - 1) })} />}
              >
                Anterior
              </Button>
            )}
            <span className="text-muted-foreground">
              Página {page} de {totalPages} — {total} cliente(s)
            </span>
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                Siguiente
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={buildHref(sp, { page: String(page + 1) })} />}
              >
                Siguiente
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
