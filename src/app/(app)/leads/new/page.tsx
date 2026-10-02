import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listActiveAgents } from "@/services/users.service";
import { LeadForm } from "../lead-form";
import { createLeadAction } from "../actions";

export default async function NewLeadPage() {
  const actor = await requireUser();
  if (actor.role !== "ADMIN") forbidden();

  const activeAgents = await listActiveAgents(actor);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nuevo lead</h2>
      <LeadForm action={createLeadAction} activeAgents={activeAgents} />
    </div>
  );
}
