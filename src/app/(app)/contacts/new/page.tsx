import { requireUser } from "@/lib/authorization";
import { listActiveAgents } from "@/services/users.service";
import { ContactForm } from "@/app/(app)/contacts/contact-form";
import { createPersonAction } from "@/app/(app)/contacts/actions";

export default async function NewContactPage() {
  const actor = await requireUser();
  const showAgentSelect = actor.role === "ADMIN";
  const activeAgents = showAgentSelect ? await listActiveAgents(actor) : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nuevo contacto</h2>
      <ContactForm
        action={createPersonAction}
        activeAgents={activeAgents}
        showAgentSelect={showAgentSelect}
        submitLabel="Crear contacto"
      />
    </div>
  );
}
