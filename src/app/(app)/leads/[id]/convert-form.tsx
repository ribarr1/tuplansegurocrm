"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { convertLeadAction } from "./actions";

type PersonCandidate = { id: string; firstName: string; lastName: string };
type ProductOption = { id: string; name: string; carrierName: string };

export function ConvertForm({
  leadId,
  candidates,
  defaultFirstName,
  defaultLastName,
  defaultPhone,
  defaultEmail,
  products,
}: {
  leadId: string;
  candidates: PersonCandidate[];
  defaultFirstName: string;
  defaultLastName: string;
  defaultPhone: string;
  defaultEmail?: string;
  products: ProductOption[];
}) {
  const [linkMode, setLinkMode] = useState<"existing" | "new">(candidates.length > 0 ? "existing" : "new");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    if (linkMode === "new") formData.delete("personId");
    startTransition(async () => {
      const result = await convertLeadAction(leadId, formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4 rounded-md border p-4">
      <h3 className="text-sm font-medium">Convertir en cliente</h3>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        {candidates.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="linkMode"
              checked={linkMode === "existing"}
              onChange={() => setLinkMode("existing")}
            />
            Vincular a un contacto existente
          </label>
        )}
        {linkMode === "existing" && candidates.length > 0 && (
          <select name="personId" className="h-9 rounded-md border border-input bg-background px-3 text-sm" defaultValue={candidates[0].id}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="linkMode" checked={linkMode === "new"} onChange={() => setLinkMode("new")} />
          Crear un contacto nuevo
        </label>
      </div>

      {linkMode === "new" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="firstName">Nombre</Label>
            <Input id="firstName" name="firstName" defaultValue={defaultFirstName} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lastName">Apellido</Label>
            <Input id="lastName" name="lastName" defaultValue={defaultLastName} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" name="phone" defaultValue={defaultPhone} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Correo</Label>
            <Input id="email" name="email" defaultValue={defaultEmail} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t pt-3">
        <span className="text-sm">¿El titular queda cubierto por esta póliza?</span>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="holderCovered" value="true" defaultChecked />
            Sí
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="holderCovered" value="false" />
            No (ej. solo gestiona la póliza de otro miembro del hogar)
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Puedes agregar cónyuge/hijos u otros miembros cubiertos después, desde la edición normal de la póliza —
          esta conversión solo decide si el titular mismo queda cubierto.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="productId">Producto</Label>
          <select id="productId" name="productId" required className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="" disabled>
              Selecciona un producto
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.carrierName} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyNumber">Número de póliza (opcional)</Label>
          <Input id="policyNumber" name="policyNumber" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="effectiveDate">Fecha efectiva (opcional)</Label>
          <Input id="effectiveDate" name="effectiveDate" type="date" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="premiumAmount">Prima (opcional)</Label>
          <Input id="premiumAmount" name="premiumAmount" placeholder="125.50" />
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Convirtiendo…" : "Convertir y crear póliza PENDING"}
      </Button>
    </form>
  );
}
