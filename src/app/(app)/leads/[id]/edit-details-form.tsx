"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { US_STATES } from "@/lib/us-states";
import { updateLeadDetailsAction } from "./actions";
import type { UpdateLeadDetailsFormState } from "./form-helpers";

const PRODUCT_TYPES = ["HEALTH", "LIFE", "SUPPLEMENTAL", "DENTAL", "FINAL_EXPENSE"] as const;

export function EditLeadDetailsForm({
  leadId,
  fullName,
  phone,
  email,
  residenceState,
  productInterest,
}: {
  leadId: string;
  fullName: string;
  phone: string;
  email: string | null;
  residenceState: string | null;
  productInterest: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, isPending] = useActionState<UpdateLeadDetailsFormState, FormData>(
    (prev, formData) => updateLeadDetailsAction(leadId, prev, formData),
    undefined
  );

  if (!isEditing) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
        Editar datos
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-sm font-medium">Editar datos del lead</h3>

      {state?.success && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Datos actualizados.
        </p>
      )}

      {state?.success && state.phoneChanged && (
        <div className="rounded-md border border-amber-400/60 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
          {state.personMatches && state.personMatches.length > 0 ? (
            <>
              <p className="font-medium">
                El nuevo teléfono coincide con {state.personMatches.length === 1 ? "un contacto" : "varios contactos"}{" "}
                existente{state.personMatches.length === 1 ? "" : "s"} — no se vinculó automáticamente:
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {state.personMatches.map((p) => (
                  <li key={p.id}>
                    <Link href={`/contacts/${p.id}`} className="underline">
                      {p.firstName} {p.lastName}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>El teléfono cambió y no coincide con ningún contacto existente.</p>
          )}
        </div>
      )}

      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-fullName">Nombre completo</Label>
          <Input id="edit-fullName" name="fullName" defaultValue={state?.values?.fullName ?? fullName} required />
          {state?.fieldErrors?.fullName && <p className="text-sm text-destructive">{state.fieldErrors.fullName}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-phone">Teléfono</Label>
          <Input id="edit-phone" name="phone" defaultValue={state?.values?.phone ?? phone} required />
          {state?.fieldErrors?.phone && <p className="text-sm text-destructive">{state.fieldErrors.phone}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-email">Correo (opcional)</Label>
          <Input id="edit-email" name="email" type="email" defaultValue={state?.values?.email ?? email ?? ""} />
          {state?.fieldErrors?.email && <p className="text-sm text-destructive">{state.fieldErrors.email}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-residenceState">Estado de residencia (opcional)</Label>
          <select
            id="edit-residenceState"
            name="residenceState"
            defaultValue={state?.values?.residenceState ?? residenceState ?? ""}
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
          <Label htmlFor="edit-productInterest">Producto de interés (opcional)</Label>
          <select
            id="edit-productInterest"
            name="productInterest"
            defaultValue={state?.values?.productInterest ?? productInterest ?? ""}
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

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
            Cerrar
          </Button>
        </div>
      </form>
    </div>
  );
}
