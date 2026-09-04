"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";

// Hallazgo #5 de UAT (Fase 024): filtros en cascada Tipo -> Compañía
// para crear una póliza. Cambiar el Tipo SIEMPRE limpia la Compañía ya
// elegida (casi nunca sigue siendo válida para el nuevo tipo, y dejarla
// visible/aplicada sería una selección "stale" invisible para el
// usuario) — el combo de Compañía que recibe este componente ya viene
// acotado por el servidor a los carriers con al menos un Product activo
// de ese tipo (ver policies/new/page.tsx::listCarriersForPolicyType).
// Auto-submit con router.push en vez de un botón "Filtrar": la cascada
// debe sentirse inmediata, no un paso manual extra.
export function PolicyCatalogFilter({
  holderId,
  policyType,
  carrierId,
  carriers,
}: {
  holderId: string;
  policyType?: string;
  carrierId?: string;
  carriers: { id: string; name: string }[];
}) {
  const router = useRouter();

  function navigate(next: { policyType?: string; carrierId?: string }) {
    const params = new URLSearchParams();
    params.set("holderId", holderId);
    const nextType = "policyType" in next ? next.policyType : policyType;
    const nextCarrier = "carrierId" in next ? next.carrierId : carrierId;
    if (nextType) params.set("policyType", nextType);
    if (nextCarrier) params.set("carrierId", nextCarrier);
    router.push(`/policies/new?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="policyType">Tipo de seguro</Label>
        <select
          id="policyType"
          value={policyType ?? ""}
          onChange={(e) => navigate({ policyType: e.target.value || undefined, carrierId: undefined })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos</option>
          {POLICY_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {POLICY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="carrierId">Compañía</Label>
        <select
          id="carrierId"
          value={carrierId ?? ""}
          onChange={(e) => navigate({ carrierId: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas</option>
          {carriers.map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
