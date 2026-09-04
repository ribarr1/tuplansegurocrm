import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { canEditPerson, getPersonById } from "@/services/people.service";
import { listActiveAgents } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/app/(app)/contacts/contact-form";
import { updatePersonAction } from "@/app/(app)/contacts/actions";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let person;
  try {
    person = await getPersonById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  // canEditPerson es la misma función que usa el servicio para
  // autorizar la escritura (ver people.service.ts) — aquí solo decide
  // qué renderizar, no reemplaza esa verificación.
  if (!canEditPerson(actor, person)) {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">
          No tienes permiso para editar este contacto.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href={`/contacts/${id}`} />}>
          Volver
        </Button>
      </div>
    );
  }

  const showAgentSelect = actor.role === "ADMIN";
  const activeAgents = showAgentSelect ? await listActiveAgents(actor) : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">
        Editar contacto — {person.firstName} {person.lastName}
      </h2>
      <ContactForm
        action={updatePersonAction.bind(null, id)}
        defaultValues={{
          firstName: person.firstName,
          lastName: person.lastName,
          phone: person.phone,
          email: person.email,
          dateOfBirth: person.dateOfBirth
            ? person.dateOfBirth.toISOString().slice(0, 10)
            : undefined,
          contactStatus: person.contactStatus,
          assignedAgentId: person.assignedAgentId,
        }}
        activeAgents={activeAgents}
        showAgentSelect={showAgentSelect}
        submitLabel="Guardar cambios"
        isEditing
      />
    </div>
  );
}
