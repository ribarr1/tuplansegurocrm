"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { USDateInput } from "@/components/ui/us-date-input";
import { Label } from "@/components/ui/label";
import { CONTACT_STATUS_VALUES } from "@/schemas/person.schema";
import { CONTACT_STATUS_LABELS } from "@/lib/labels";
import type { PersonFormState } from "./form-helpers";

export type ContactFormDefaultValues = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string; // yyyy-mm-dd
  contactStatus?: string;
  assignedAgentId?: string | null;
};

export function ContactForm({
  action,
  defaultValues,
  activeAgents = [],
  showAgentSelect,
  submitLabel,
}: {
  action: (state: PersonFormState, formData: FormData) => Promise<PersonFormState>;
  defaultValues?: ContactFormDefaultValues;
  activeAgents?: { id: string; name: string }[];
  showAgentSelect: boolean;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);

  // Tras un error, React 19 limpia los campos no controlados del
  // <form> al terminar la Server Action. state.values (lo que el
  // usuario envió) sustituye a defaultValues para no perder lo ya
  // escrito; el `key` en el <form> fuerza a React a remontar los
  // inputs para que tomen el nuevo defaultValue (si no, al ser el
  // mismo nodo, React ignora el cambio de defaultValue).
  const values = state?.values ?? defaultValues ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-xl flex-col gap-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="firstName">Nombre</Label>
        <Input id="firstName" name="firstName" defaultValue={values.firstName} required />
        {state?.fieldErrors?.firstName && (
          <p className="text-sm text-destructive">{state.fieldErrors.firstName}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="lastName">Apellido</Label>
        <Input id="lastName" name="lastName" defaultValue={values.lastName} required />
        {state?.fieldErrors?.lastName && (
          <p className="text-sm text-destructive">{state.fieldErrors.lastName}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="phone">Teléfono</Label>
        <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
        {state?.fieldErrors?.phone && (
          <p className="text-sm text-destructive">{state.fieldErrors.phone}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
        {state?.fieldErrors?.email && (
          <p className="text-sm text-destructive">{state.fieldErrors.email}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dateOfBirth">Fecha de nacimiento (MM/DD/AAAA)</Label>
        <USDateInput id="dateOfBirth" name="dateOfBirth" defaultValue={values.dateOfBirth} />
        {state?.fieldErrors?.dateOfBirth && (
          <p className="text-sm text-destructive">{state.fieldErrors.dateOfBirth}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="contactStatus">Estado</Label>
        <select
          id="contactStatus"
          name="contactStatus"
          defaultValue={values.contactStatus ?? "PROSPECT"}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {CONTACT_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {CONTACT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {showAgentSelect && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="assignedAgentId">Agente asignado</Label>
          <select
            id="assignedAgentId"
            name="assignedAgentId"
            defaultValue={values.assignedAgentId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin asignar</option>
            {activeAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.assignedAgentId && (
            <p className="text-sm text-destructive">{state.fieldErrors.assignedAgentId}</p>
          )}
        </div>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
