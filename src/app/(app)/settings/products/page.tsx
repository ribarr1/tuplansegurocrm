import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listProducts } from "@/services/products.service";
import { listCarriers } from "@/services/carriers.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { ToggleProductActiveButton } from "./toggle-active-button";

type SearchParams = { carrierId?: string; policyType?: string; active?: string; page?: string };

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.carrierId) params.set("carrierId", merged.carrierId);
  if (merged.policyType) params.set("policyType", merged.policyType);
  if (merged.active) params.set("active", merged.active);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/settings/products?${qs}` : "/settings/products";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const policyType = (POLICY_TYPE_VALUES as readonly string[]).includes(sp.policyType ?? "")
    ? sp.policyType
    : undefined;
  const active = sp.active === "true" || sp.active === "false" ? sp.active : undefined;

  const [{ items, total, pageSize }, carriers] = await Promise.all([
    listProducts(actor, { carrierId: sp.carrierId || undefined, policyType, active, page }),
    listCarriers(actor, {}),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isAdmin = actor.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Productos</h2>
        {isAdmin && (
          <Button nativeButton={false} render={<Link href="/settings/products/new" />}>
            + Nuevo producto
          </Button>
        )}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
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
          <Label htmlFor="active">Estado</Label>
          <select
            id="active"
            name="active"
            defaultValue={sp.active ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.carrierId || sp.policyType || sp.active) && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/settings/products" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay productos con esos filtros.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Compañía</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Año</TableHead>
                  <TableHead>Código externo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead># Pólizas</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      {product.carrier.name}
                      {!product.carrier.isActive && (
                        <Badge variant="outline" className="ml-2">
                          Compañía inactiva
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{POLICY_TYPE_LABELS[product.policyType]}</TableCell>
                    <TableCell>{product.planYear ?? "—"}</TableCell>
                    <TableCell>{product.externalCode ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={product.isActive ? "default" : "outline"}>
                        {product.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell>{product._count.policies}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {isAdmin && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            nativeButton={false}
                            render={<Link href={`/settings/products/${product.id}/edit`} />}
                          >
                            Editar
                          </Button>
                          <ToggleProductActiveButton
                            productId={product.id}
                            isActive={product.isActive}
                          />
                        </>
                      )}
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
