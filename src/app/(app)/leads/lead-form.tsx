"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { US_STATES } from "@/lib/us-states";
import type { LeadFormState } from "./form-helpers";

const PRODUCT_TYPES = ["HEALTH", "LIFE", "SUPPLEMENTAL", "DENTAL", "FINAL_EXPENSE"] as const;

export function LeadForm({
  action,
  activeAgents,
}: {
  action: (state: LeadFormState, formData: FormData) => Promise<LeadFormState>;
  activeAgents: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border p-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input id="fullName" name="fullName" defaultValue={values.fullName} required />
          {state?.fieldErrors?.fullName && <p className="text-sm text-destructive">{state.fieldErrors.fullName}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={values.phone} required />
          {state?.fieldErrors?.phone && <p className="text-sm text-destructive">{state.fieldErrors.phone}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="email">Correo (opcional)</Label>
          <Input id="email" name="email" type="email" defaultValue={values.email} />
          {state?.fieldErrors?.email && <p className="text-sm text-destructive">{state.fieldErrors.email}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="residenceState">Estado de residencia (opcional)</Label>
          <select
            id="residenceState"
            name="residenceState"
            defaultValue={values.residenceState ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin especificar</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="productInterest">Producto de interés (opcional)</Label>
          <select
            id="productInterest"
            name="productInterest"
            defaultValue={values.productInterest ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin especificar</option>
            {PRODUCT_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="assignedToId">Agente (opcional)</Label>
          <select
            id="assignedToId"
            name="assignedToId"
            defaultValue={values.assignedToId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin asignar</option>
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="campaignId">ID de campaña (opcional)</Label>
          <Input id="campaignId" name="campaignId" defaultValue={values.campaignId} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="campaignName">Nombre de campaña (opcional)</Label>
          <Input id="campaignName" name="campaignName" defaultValue={values.campaignName} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="consentGiven">Autorización de contacto</Label>
          <select
            id="consentGiven"
            name="consentGiven"
            defaultValue={values.consentGiven ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">No especificado</option>
            <option value="true">Autorizó</option>
            <option value="false">Negó explícitamente</option>
          </select>
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Crear lead"}
      </Button>
    </form>
  );
}
