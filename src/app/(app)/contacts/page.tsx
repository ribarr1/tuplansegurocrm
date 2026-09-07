import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listPeople } from "@/services/people.service";
import { listActiveAgents } from "@/services/users.service";
import {
  listContactsWithReviewInfo,
  listReviewCandidates,
  getReviewStatusesByIds,
} from "@/services/google-reviews.service";
import { GOOGLE_REVIEW_STATUS_LABELS } from "@/lib/labels";
import { GOOGLE_REVIEW_STATUS_VALUES } from "@/schemas/google-review.schema";
import type { GoogleReviewStatus } from "@/generated/prisma/client";
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
import { CONTACT_STATUS_VALUES, UNASSIGNED_AGENT_FILTER } from "@/schemas/person.schema";

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
  review?: string;
  assignedAgentId?: string;
};

function buildQueryString(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.review) params.set("review", merged.review);
  if (merged.assignedAgentId) params.set("assignedAgentId", merged.assignedAgentId);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  return params.toString();
}

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const qs = buildQueryString(current, overrides);
  return qs ? `/contacts?${qs}` : "/contacts";
}

// Fase 025.5.1 (UAT-11): "Exportar CSV" exporta lo que la pantalla
// muestra — mismos filtros, sin paginación (ver exportContactsCsv).
function buildExportHref(current: SearchParams): string {
  const qs = buildQueryString(current, { page: undefined });
  return qs ? `/api/export/contacts?${qs}` : "/api/export/contacts";
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
  const isAdmin = actor.role === "ADMIN";
  const reviewFilter = isAdmin && (GOOGLE_REVIEW_STATUS_VALUES as readonly string[]).includes(sp.review ?? "")
    ? (sp.review as GoogleReviewStatus)
    : undefined;
  const isCandidatesView = isAdmin && sp.review === "CANDIDATES";
  const assignedAgentId =
    sp.assignedAgentId === UNASSIGNED_AGENT_FILTER || /^[0-9a-f-]{36}$/i.test(sp.assignedAgentId ?? "")
      ? sp.assignedAgentId
      : undefined;

  // Fase 025.5 (UAT-10): "A quién pedir reseña" y el filtro por estado
  // de reseña son EXCLUSIVAMENTE ADMIN — para cualquier otro rol (o si
  // no hay ningún filtro de reseña activo) se usa el listado normal
  // sin ningún dato de reseña, tal como antes de esta fase.
  type ContactRow = {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    contactStatus: (typeof CONTACT_STATUS_VALUES)[number];
    assignedAgent: { id: string; name: string } | null;
    googleReviewStatus?: GoogleReviewStatus;
  };

  const { items, total, pageSize }: { items: ContactRow[]; total: number; pageSize: number } = isCandidatesView
    ? await listReviewCandidates(actor, { page })
    : reviewFilter
      ? await listContactsWithReviewInfo(actor, {
          search: sp.q || undefined,
          contactStatus: status,
          reviewStatus: reviewFilter,
          assignedAgentId,
          page,
        })
      : await listPeople(actor, {
          search: sp.q || undefined,
          contactStatus: status,
          assignedAgentId,
          page,
        });

  // Solo ADMIN/ASSISTANT pueden consultar el catálogo de agentes (ver
  // listActiveAgents) — el filtro por agente se oculta para AGENT, que
  // de todas formas solo ve su propia cartera en otras pantallas.
  const activeAgents = actor.role === "ADMIN" || actor.role === "ASSISTANT" ? await listActiveAgents(actor) : [];

  // Vista normal + ADMIN: se decora con el estado de reseña solo para
  // mostrar la columna — nunca se usa para filtrar aquí (eso ya lo
  // hicieron las ramas de arriba cuando corresponde).
  const reviewStatusById = isAdmin && !reviewFilter && !isCandidatesView
    ? await getReviewStatusesByIds(actor, items.map((i) => i.id))
    : null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(sp.q || sp.status || sp.review || sp.assignedAgentId);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Contactos</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<a href={buildExportHref(sp)} />}>
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
        {activeAgents.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignedAgentId">Agente asignado</Label>
            <select
              id="assignedAgentId"
              name="assignedAgentId"
              defaultValue={sp.assignedAgentId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              <option value={UNASSIGNED_AGENT_FILTER}>Sin asignar</option>
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isAdmin && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="review">Reseña de Google</Label>
            <select
              id="review"
              name="review"
              defaultValue={sp.review ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {GOOGLE_REVIEW_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {GOOGLE_REVIEW_STATUS_LABELS[s]}
                </option>
              ))}
              <option value="CANDIDATES">A quién pedir reseña</option>
            </select>
          </div>
        )}
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
                  {isAdmin && <TableHead>Reseña de Google</TableHead>}
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((person) => {
                  const reviewStatus = person.googleReviewStatus ?? reviewStatusById?.get(person.id);
                  return (
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
                    <TableCell>{person.assignedAgent?.name ?? "Sin asignar"}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        {reviewStatus ? (
                          <Badge variant="outline">{GOOGLE_REVIEW_STATUS_LABELS[reviewStatus]}</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
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
