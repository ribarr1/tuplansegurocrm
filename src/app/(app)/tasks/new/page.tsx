import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPersonById } from "@/services/people.service";
import { getPolicyById } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { TaskForm } from "../task-form";
import { createTaskAction } from "../actions";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string; policyId?: string }>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;

  let contextLabel: string | undefined;

  if (sp.personId) {
    try {
      const person = await getPersonById(actor, sp.personId);
      contextLabel = `Contacto: ${person.firstName} ${person.lastName}`;
    } catch (error) {
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
        notFound();
      }
      throw error;
    }
  } else if (sp.policyId) {
    try {
      const policy = await getPolicyById(actor, sp.policyId);
      contextLabel = `Póliza: ${policy.policyNumber ?? "sin número"} — ${policy.holder.firstName} ${policy.holder.lastName}`;
    } catch (error) {
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
        notFound();
      }
      throw error;
    }
  }

  const showAssigneeSelect = actor.role !== "AGENT";
  const activeAgents = showAssigneeSelect ? await listActiveAgents(actor) : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Nueva tarea</h2>
      <TaskForm
        action={createTaskAction}
        personId={sp.personId}
        policyId={sp.policyId}
        contextLabel={contextLabel}
        showAssigneeSelect={showAssigneeSelect}
        activeAgents={activeAgents}
      />
    </div>
  );
}
