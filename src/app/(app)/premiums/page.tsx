import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listPremiumTracking } from "@/services/premiums.service";
import { listActiveCarriers } from "@/services/policies.service";
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
import { BILLING_FREQUENCY_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { PAYMENT_STATUS_VALUES } from "@/schemas/policy.schema";
import { formatDateOnlyUS } from "@/lib/date-only";

type SearchParams = {
  q?: string;
  dueToday?: string;
  next7Days?: string;
  next30Days?: string;
  overdueOnly?: string;
  needsAssistance?: string;
  autopay?: string;
  paymentStatus?: string;
  carrierId?: string;
  agentId?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.dueToday) params.set("dueToday", merged.dueToday);
  if (merged.next7Days) params.set("next7Days", merged.next7Days);
  if (merged.next30Days) params.set("next30Days", merged.next30Days);
  if (merged.overdueOnly) params.set("overdueOnly", merged.overdueOnly);
  if (merged.needsAssistance) params.set("needsAssistance", merged.needsAssistance);
  if (merged.autopay) params.set("autopay", merged.autopay);
  if (merged.paymentStatus) params.set("paymentStatus", merged.paymentStatus);
  if (merged.carrierId) params.set("carrierId", merged.carrierId);
  if (merged.agentId) params.set("agentId", merged.agentId);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/premiums?${qs}` : "/premiums";
}

function formatMoney(amount: { toFixed: (n: number) => string } | null): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

const formatDueDate = formatDateOnlyUS;

const QUICK_VIEWS = [
  { key: "all", label: "Todas", param: undefined },
  { key: "dueToday", label: "Vencen hoy", param: "dueToday" },
  { key: "next7Days", label: "Próximos 7 días", param: "next7Days" },
  { key: "next30Days", label: "Próximos 30 días", param: "next30Days" },
  { key: "overdueOnly", label: "Vencidas", param: "overdueOnly" },
] as const;

export default async function PremiumsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const paymentStatus = (PAYMENT_STATUS_VALUES as readonly string[]).includes(sp.paymentStatus ?? "")
    ? sp.paymentStatus
    : undefined;

  const [{ items, total, pageSize }, carriers, agents] = await Promise.all([
    listPremiumTracking(actor, {
      search: sp.q || undefined,
      dueToday: sp.dueToday,
      next7Days: sp.next7Days,
      next30Days: sp.next30Days,
      overdueOnly: sp.overdueOnly,
      needsAssistance: sp.needsAssistance,
      autopay: sp.autopay,
      paymentStatus,
      carrierId: sp.carrierId || undefined,
      agentId: sp.agentId || undefined,
      page,
    }),
    listActiveCarriers(actor),
    actor.role !== "AGENT" ? listActiveAgents(actor) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeQuickView =
    QUICK_VIEWS.find((v) => v.param && sp[v.param as keyof SearchParams] === "true")?.key ?? "all";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Primas / Pagos</h2>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {QUICK_VIEWS.map((view) => (
          <Link
            key={view.key}
            href={view.param ? `/premiums?${view.param}=true` : "/premiums"}
            className={
              activeQuickView === view.key
                ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium"
                : "px-3 py-2 text-sm text-muted-foreground"
            }
          >
            {view.label}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input id="q" name="q" placeholder="Póliza o titular" defaultValue={sp.q ?? ""} className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentStatus">Estado de pago</Label>
          <select
            id="paymentStatus"
            name="paymentStatus"
            defaultValue={sp.paymentStatus ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {PAYMENT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {PAYMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="autopay">Autopay</Label>
          <select
            id="autopay"
            name="autopay"
            defaultValue={sp.autopay ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
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
            {carriers.map((carrier) => (
              <option key={carrier.id} value={carrier.id}>
                {carrier.name}
              </option>
            ))}
          </select>
        </div>
        {actor.role !== "AGENT" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="agentId">Agente</Label>
            <select
              id="agentId"
              name="agentId"
              defaultValue={sp.agentId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="needsAssistance"
            value="true"
            defaultChecked={sp.needsAssistance === "true"}
          />
          Necesita asistencia
        </label>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.q ||
          sp.needsAssistance ||
          sp.autopay ||
          sp.paymentStatus ||
          sp.carrierId ||
          sp.agentId) && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/premiums" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay pólizas con esos filtros.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titular</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Compañía</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Próximo pago</TableHead>
                  <TableHead>Autopay</TableHead>
                  <TableHead>Asistencia</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/contacts/${item.holder.id}`} className="underline">
                        {item.holder.firstName} {item.holder.lastName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/policies/${item.id}`} className="underline">
                        {item.policyNumber ?? "sin número"}
                      </Link>
                    </TableCell>
                    <TableCell>{item.product.carrier.name}</TableCell>
                    <TableCell>{item.product.name}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.premiumAmount)}</TableCell>
                    <TableCell>
                      {item.billingFrequency ? BILLING_FREQUENCY_LABELS[item.billingFrequency] : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDueDate(item.nextPaymentDueDate)}
                        {item.isOverdue && <Badge variant="destructive">Vencida</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{item.autopay ? "Sí" : "No"}</TableCell>
                    <TableCell>
                      {item.needsPaymentAssistance ? (
                        <Badge variant="secondary">Requiere asistencia</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {item.paymentStatus ? PAYMENT_STATUS_LABELS[item.paymentStatus] : "—"}
                    </TableCell>
                  </TableRow>
                ))}
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
              Página {page} de {totalPages}
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
