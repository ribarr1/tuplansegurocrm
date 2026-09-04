import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listPeople } from "@/services/people.service";
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
import { CONTACT_STATUS_BADGE_VARIANT, CONTACT_STATUS_LABELS } from "@/lib/labels";
import { CONTACT_STATUS_VALUES } from "@/schemas/person.schema";

type SearchParams = { q?: string; status?: string; page?: string };

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const status = (CONTACT_STATUS_VALUES as readonly string[]).includes(sp.status ?? "")
    ? sp.status
    : undefined;

  const { items, total, pageSize } = await listPeople(actor, {
    search: sp.q || undefined,
    contactStatus: status,
    page,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(sp.q || sp.status);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Contactos</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<a href="/api/export/contacts" />}>
            Exportar CSV
          </Button>
          <Button nativeButton={false} render={<Link href="/contacts/new" />}>
            + Nuevo contacto
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          {/* Fase 022 (Hallazgo #7 de UAT): ver policies/new/page.tsx. */}
          <Input
            key={sp.q ?? ""}
            id="q"
            name="q"
            placeholder="Nombre, teléfono o correo"
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
            {CONTACT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {CONTACT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {hasFilters && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/contacts" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters
              ? "No encontramos contactos con esos filtros."
              : "No hay contactos todavía."}
          </p>
          {!hasFilters && (
            <Button nativeButton={false} render={<Link href="/contacts/new" />}>
              Crear primer contacto
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Agente asignado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">
                      {person.firstName} {person.lastName}
                    </TableCell>
                    <TableCell>{person.phone ?? "—"}</TableCell>
                    <TableCell>{person.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={CONTACT_STATUS_BADGE_VARIANT[person.contactStatus]}>
                        {CONTACT_STATUS_LABELS[person.contactStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell>{person.assignedAgent?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/contacts/${person.id}`} />}
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
