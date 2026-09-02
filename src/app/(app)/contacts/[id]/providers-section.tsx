import { listPersonProviders } from "@/services/health-records.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROVIDER_TYPE_LABELS } from "@/lib/labels";
import { ProviderDialog } from "./provider-dialog";
import { DeleteProviderButton } from "./delete-provider-button";

// Hallazgo #18 de UAT (Fase 019.8): vive en Person, nunca en Policy.
export async function ProvidersSection({
  actor,
  personId,
}: {
  actor: AuthorizedUser;
  personId: string;
}) {
  const providers = await listPersonProviders(actor, personId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Médicos / proveedores preferidos
        </CardTitle>
        <ProviderDialog personId={personId} triggerLabel="+ Agregar proveedor" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {providers.length === 0 ? (
          <p className="text-muted-foreground">Sin médicos/proveedores registrados.</p>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  {provider.name}
                  <Badge variant="outline">{PROVIDER_TYPE_LABELS[provider.type]}</Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {[provider.specialty, provider.phone].filter(Boolean).join(" · ") || "—"}
                </span>
                {provider.notes && <span className="text-xs text-muted-foreground">{provider.notes}</span>}
              </div>
              <div className="flex items-center gap-2">
                <ProviderDialog
                  personId={personId}
                  provider={provider}
                  triggerLabel="Editar"
                  triggerVariant="outline"
                />
                <DeleteProviderButton
                  providerId={provider.id}
                  personId={personId}
                  providerName={provider.name}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
