import Link from "next/link";
import { getTasksForPerson, isTaskOverdue } from "@/services/tasks.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE_VARIANT,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE_VARIANT,
} from "@/lib/labels";
import { formatDateTimeUS } from "@/lib/business-time";

function formatDueAt(date: Date | null): string {
  return formatDateTimeUS(date);
}

export async function TasksTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const tasks = await getTasksForPerson(actor, personId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button nativeButton={false} render={<Link href={`/tasks/new?personId=${personId}`} />}>
          + Nueva tarea
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">Esta persona no tiene tareas todavía.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="flex flex-col gap-2 rounded-md border p-4 hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{task.title}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={TASK_PRIORITY_BADGE_VARIANT[task.priority]}>
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </Badge>
                  <Badge variant={TASK_STATUS_BADGE_VARIANT[task.status]}>
                    {TASK_STATUS_LABELS[task.status]}
                  </Badge>
                  {isTaskOverdue(task) && <Badge variant="destructive">Vencida</Badge>}
                </div>
              </div>
              <span className="text-sm text-muted-foreground">Vence: {formatDueAt(task.dueAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
