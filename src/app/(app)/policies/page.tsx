import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listPolicies, listActiveCarriers } from "@/services/policies.service";
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
  POLICY_STATUS_BADGE_VARIANT,
  POLICY_STATUS_LABELS,
  POLICY_TYPE_LABELS,
  HEALTH_COVERAGE_SOURCE_LABELS,
} from "@/lib/labels";
import { formatDateOnlyUS } from "@/lib/date-only";
import { POLICY_STATUS_VALUES, POLICY_TYPE_VALUES, HEALTH_COVERAGE_SOURCE_VALUES } from "@/schemas/policy.schema";

type SearchParams = {
  q?: string;
  status?: string;
  policyType?: string;
  carrierId?: string;
  healthSource?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.policyType) params.set("policyType", merged.policyType);
  if (merged.carrierId) params.set("carrierId", merged.carrierId);
  if (merged.healthSource) params.set("healthSource", merged.healthSource);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/policies?${qs}` : "/policies";
}

const formatDate = formatDateOnlyUS;

function formatMoney(amount: unknown): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const status = (POLICY_STATUS_VALUES as readonly string[]).includes(sp.status ?? "")
    ? sp.status
    : undefined;
  const policyType = (POLICY_TYPE_VALUES as readonly string[]).includes(sp.policyType ?? "")
    ? sp.policyType
    : undefined;
  const healthSource = (HEALTH_COVERAGE_SOURCE_VALUES as readonly string[]).includes(
    sp.healthSource ?? ""
  )
    ? sp.healthSource
    : undefined;

  const [{ items, total, pageSize }, carriers] = await Promise.all([
    listPolicies(actor, {
      search: sp.q || undefined,
      status,
      policyType,
      carrierId: sp.carrierId || undefined,
      healthSource,
      page,
    }),
    listActiveCarriers(actor),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(sp.q || sp.status || sp.policyType || sp.carrierId || sp.healthSource);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Pólizas</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<a href="/api/export/policies" />}>
            Exportar CSV
          </Button>
          <Button nativeButton={false} render={<Link href="/policies/new" />}>
            + Nueva póliza
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input
            id="q"
            name="q"
            placeholder="Número de póliza o titular"
            defaultValue={sp.q ?? ""}
            className="w-64"
          />
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
            {POLICY_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {POLICY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo</Label>
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
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="healthSource">Cobertura de Salud</Label>
          <select
            id="healthSource"
            name="healthSource"
            defaultValue={sp.healthSource ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {HEALTH_COVERAGE_SOURCE_VALUES.map((source) => (
              <option key={source} value={source}>
                {HEALTH_COVERAGE_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {hasFilters && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/policies" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "No encontramos pólizas con esos filtros." : "No hay pólizas todavía."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Titular</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Compañía / producto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha efectiva</TableHead>
                  <TableHead>Prima</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell className="font-medium">{policy.policyNumber ?? "—"}</TableCell>
                    <TableCell>
                      {policy.holder.firstName} {policy.holder.lastName}
                    </TableCell>
                    <TableCell>{POLICY_TYPE_LABELS[policy.product.policyType]}</TableCell>
                    <TableCell>
                      {policy.product.carrier.name} — {policy.product.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={POLICY_STATUS_BADGE_VARIANT[policy.status]}>
                        {POLICY_STATUS_LABELS[policy.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(policy.effectiveDate)}</TableCell>
                    <TableCell>{formatMoney(policy.premiumAmount)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/policies/${policy.id}`} />}
                      >
                        Ver
                      </Button>
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
