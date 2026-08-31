import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getTaskById } from "@/services/tasks.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { EditTaskForm } from "../edit-task-form";
import { updateTaskAction } from "../../actions";

function toDatetimeLocal(date: Date | null): string | undefined {
  if (!date) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EditTaskPage({
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

  const showAssigneeSelect = actor.role !== "AGENT";
  const activeAgents = showAssigneeSelect ? await listActiveAgents(actor) : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Editar tarea — {task.title}</h2>
      <EditTaskForm
        action={updateTaskAction.bind(null, id)}
        defaultValues={{
          title: task.title,
          description: task.description ?? undefined,
          status: task.status,
          priority: task.priority,
          dueAt: toDatetimeLocal(task.dueAt),
          assignedToId: task.assignedTo?.id,
        }}
        showAssigneeSelect={showAssigneeSelect}
        activeAgents={activeAgents}
      />
    </div>
  );
}
