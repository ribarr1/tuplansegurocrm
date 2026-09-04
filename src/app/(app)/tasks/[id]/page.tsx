import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getTaskById, isTaskOverdue } from "@/services/tasks.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_BADGE_VARIANT,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE_VARIANT,
} from "@/lib/labels";
import { TaskActionButtons } from "./task-actions-buttons";
import { formatDateTimeUS } from "@/lib/business-time";

function formatDate(date: Date | null): string {
  return formatDateTimeUS(date);
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let task;
  try {
    task = await getTaskById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a esta tarea.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/tasks" />}>
            Volver
          </Button>
        </div>
      );
    }
    throw error;
  }

  const overdue = isTaskOverdue(task);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-semibold">{task.title}</h2>
          <Badge variant={TASK_STATUS_BADGE_VARIANT[task.status]}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
          <Badge variant={TASK_PRIORITY_BADGE_VARIANT[task.priority]}>
            {TASK_PRIORITY_LABELS[task.priority]}
          </Badge>
          {overdue && <Badge variant="destructive">Vencida</Badge>}
        </div>
        <div className="flex gap-2">
          <TaskActionButtons taskId={task.id} status={task.status} />
          <Button variant="outline" nativeButton={false} render={<Link href={`/tasks/${task.id}/edit`} />}>
            Editar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Detalle</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Descripción</span>
            <span className="text-right">{task.description ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Vencimiento</span>
            <span>{formatDate(task.dueAt)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Responsable</span>
            <span>{task.assignedTo?.name ?? "Sin asignar"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Creada por</span>
            <span>{task.createdBy?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Contacto</span>
            <span>
              {task.person ? (
                <Link href={`/contacts/${task.person.id}`} className="underline">
                  {task.person.firstName} {task.person.lastName}
                </Link>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Póliza</span>
            <span>
              {task.policy ? (
                <Link href={`/policies/${task.policy.id}`} className="underline">
                  {task.policy.policyNumber ?? "sin número"}
                </Link>
              ) : (
                "—"
              )}
            </span>
          </div>
          {task.completedAt && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Completada el</span>
              <span>{formatDate(task.completedAt)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
