import Link from "next/link";
import { listTasks, isTaskOverdue } from "@/services/tasks.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE_VARIANT,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE_VARIANT,
} from "@/lib/labels";
import { formatInBusinessTimeZone } from "@/lib/business-time";

function formatDueAt(date: Date | null): string {
  if (!date) return "—";
  return formatInBusinessTimeZone(date, { dateStyle: "medium", timeStyle: "short" });
}

// Lista corta (no paginada) de tareas abiertas/próximas de esta
// póliza — el detalle completo vive en /tasks?policyId=... ("Ver
// todas"). No convierte Policy detail en un dashboard.
export async function PolicyTasksSection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const { items: tasks } = await listTasks(actor, { policyId, pageSize: 5 });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Tareas relacionadas
        </CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/tasks?policyId=${policyId}`} />}
          >
            Ver todas
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/tasks/new?policyId=${policyId}`} />}
          >
            Nueva tarea
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {tasks.length === 0 ? (
          <p className="text-muted-foreground">No hay tareas registradas para esta póliza.</p>
        ) : (
          tasks.map((task) => (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted/40"
            >
              <span className="font-medium">{task.title}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatDueAt(task.dueAt)}</span>
                <Badge variant={TASK_PRIORITY_BADGE_VARIANT[task.priority]}>
                  {TASK_PRIORITY_LABELS[task.priority]}
                </Badge>
                <Badge variant={TASK_STATUS_BADGE_VARIANT[task.status]}>
                  {TASK_STATUS_LABELS[task.status]}
                </Badge>
                {isTaskOverdue(task) && <Badge variant="destructive">Vencida</Badge>}
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
