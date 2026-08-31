import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listCommissionExpectations } from "@/services/commissions.service";
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
import {
  COMMISSION_EXPECTATION_STATUS_LABELS,
  COMMISSION_DERIVED_STATUS_LABELS,
  COMMISSION_DERIVED_STATUS_BADGE_VARIANT,
} from "@/lib/labels";
import { COMMISSION_EXPECTATION_STATUS_VALUES } from "@/schemas/commission.schema";

type SearchParams = {
  q?: string;
  period?: string;
  agentId?: string;
  carrierId?: string;
  status?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.period) params.set("period", merged.period);
  if (merged.agentId) params.set("agentId", merged.agentId);
  if (merged.carrierId) params.set("carrierId", merged.carrierId);
  if (merged.status) params.set("status", merged.status);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/commissions?${qs}` : "/commissions";
}

function formatMoney(amount: { toFixed: (n: number) => string }): string {
  return `$${amount.toFixed(2)}`;
}

function formatPeriod(date: Date): string {
  return new Intl.DateTimeFormat("es-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date
  );
}

// Comisiones es FINANCIERO/RESTRINGIDO — ASSISTANT recibe un 403 real
// (no un redirect silencioso) si navega aquí, ver docs/DECISIONS.md.
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();

  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const status = (COMMISSION_EXPECTATION_STATUS_VALUES as readonly string[]).includes(
    sp.status ?? ""
  )
    ? sp.status
    : undefined;

  const [{ items, total, pageSize }, carriers, agents] = await Promise.all([
    listCommissionExpectations(actor, {
      search: sp.q || undefined,
      period: sp.period || undefined,
      agentId: sp.agentId || undefined,
      carrierId: sp.carrierId || undefined,
      status,
      page,
    }),
    listActiveCarriers(actor),
    actor.role === "ADMIN" ? listActiveAgents(actor) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Comisiones</h2>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input
            id="q"
            name="q"
            placeholder="Póliza o titular"
            defaultValue={sp.q ?? ""}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="period">Período</Label>
          <Input id="period" name="period" type="month" defaultValue={sp.period ?? ""} />
        </div>
        {actor.role === "ADMIN" && (
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Estado</Label>
          <select
            id="status"
            name="status"
            defaultValue={sp.status ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {COMMISSION_EXPECTATION_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {COMMISSION_EXPECTATION_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.q || sp.period || sp.agentId || sp.carrierId || sp.status) && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/commissions" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay comisiones con esos filtros.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Titular</TableHead>
                  <TableHead>Compañía</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((expectation) => (
                  <TableRow key={expectation.id}>
                    <TableCell>{formatPeriod(expectation.period)}</TableCell>
                    <TableCell>
                      <Link href={`/commissions/${expectation.id}`} className="underline">
                        {expectation.policy.policyNumber ?? "sin número"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {expectation.policy.holder.firstName} {expectation.policy.holder.lastName}
                    </TableCell>
                    <TableCell>{expectation.policy.product.carrier.name}</TableCell>
                    <TableCell>{expectation.policy.product.name}</TableCell>
                    <TableCell>{expectation.agent?.name ?? "Sin asignar"}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(expectation.expectedAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(expectation.receivedAmount)}
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(expectation.difference)}</TableCell>
                    <TableCell>
                      <Badge variant={COMMISSION_DERIVED_STATUS_BADGE_VARIANT[expectation.derivedStatus]}>
                        {COMMISSION_DERIVED_STATUS_LABELS[expectation.derivedStatus]}
                      </Badge>
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
