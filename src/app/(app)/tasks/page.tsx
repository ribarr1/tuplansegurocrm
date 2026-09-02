import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listTasks, isTaskOverdue } from "@/services/tasks.service";
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
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE_VARIANT,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE_VARIANT,
} from "@/lib/labels";
import { TASK_STATUS_VALUES, TASK_PRIORITY_VALUES } from "@/schemas/task.schema";
import { formatDateTimeUS } from "@/lib/business-time";

type SearchParams = {
  q?: string;
  status?: string;
  priority?: string;
  assignedToId?: string;
  dueToday?: string;
  overdueOnly?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.priority) params.set("priority", merged.priority);
  if (merged.assignedToId) params.set("assignedToId", merged.assignedToId);
  if (merged.dueToday) params.set("dueToday", merged.dueToday);
  if (merged.overdueOnly) params.set("overdueOnly", merged.overdueOnly);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function formatDueAt(date: Date | null): string {
  return formatDateTimeUS(date);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const status = (TASK_STATUS_VALUES as readonly string[]).includes(sp.status ?? "")
    ? sp.status
    : undefined;
  const priority = (TASK_PRIORITY_VALUES as readonly string[]).includes(sp.priority ?? "")
    ? sp.priority
    : undefined;

  const [{ items, total, pageSize }, assignableAgents] = await Promise.all([
    listTasks(actor, {
      search: sp.q || undefined,
      status,
      priority,
      assignedToId: sp.assignedToId || undefined,
      dueToday: sp.dueToday,
      overdueOnly: sp.overdueOnly,
      page,
    }),
    actor.role === "AGENT" ? Promise.resolve([]) : listActiveAgents(actor),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const isQuickActive = (key: "all" | "today" | "overdue" | "pending" | "completed") => {
    if (key === "all") return !sp.status && !sp.dueToday && !sp.overdueOnly;
    if (key === "today") return sp.dueToday === "true";
    if (key === "overdue") return sp.overdueOnly === "true";
    if (key === "pending") return sp.status === "OPEN";
    return sp.status === "COMPLETED";
  };
  const quickClass = (active: boolean) =>
    active ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium" : "px-3 py-2 text-sm text-muted-foreground";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Tareas</h2>
        <Button nativeButton={false} render={<Link href="/tasks/new" />}>
          + Nueva tarea
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        <Link href="/tasks" className={quickClass(isQuickActive("all"))}>
          Todas
        </Link>
        <Link href="/tasks?dueToday=true" className={quickClass(isQuickActive("today"))}>
          Hoy
        </Link>
        <Link href="/tasks?overdueOnly=true" className={quickClass(isQuickActive("overdue"))}>
          Vencidas
        </Link>
        <Link href="/tasks?status=OPEN" className={quickClass(isQuickActive("pending"))}>
          Pendientes
        </Link>
        <Link href="/tasks?status=COMPLETED" className={quickClass(isQuickActive("completed"))}>
          Completadas
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          <Input id="q" name="q" placeholder="Título" defaultValue={sp.q ?? ""} className="w-56" />
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
            {TASK_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="priority">Prioridad</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={sp.priority ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {TASK_PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {actor.role !== "AGENT" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignedToId">Responsable</Label>
            <select
              id="assignedToId"
              name="assignedToId"
              defaultValue={sp.assignedToId ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {assignableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.q || sp.status || sp.priority || sp.assignedToId) && (
          <Button variant="ghost" nativeButton={false} render={<Link href="/tasks" />}>
            Limpiar
          </Button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay tareas con esos filtros.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>
                      {task.person ? (
                        <Link href={`/contacts/${task.person.id}`} className="underline">
                          {task.person.firstName} {task.person.lastName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {task.policy ? (
                        <Link href={`/policies/${task.policy.id}`} className="underline">
                          {task.policy.policyNumber ?? "sin número"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TASK_PRIORITY_BADGE_VARIANT[task.priority]}>
                        {TASK_PRIORITY_LABELS[task.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={TASK_STATUS_BADGE_VARIANT[task.status]}>
                          {TASK_STATUS_LABELS[task.status]}
                        </Badge>
                        {isTaskOverdue(task) && <Badge variant="destructive">Vencida</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{formatDueAt(task.dueAt)}</TableCell>
                    <TableCell>{task.assignedTo?.name ?? "Sin asignar"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/tasks/${task.id}`} />}
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
