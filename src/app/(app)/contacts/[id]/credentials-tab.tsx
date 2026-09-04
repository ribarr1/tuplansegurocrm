import type { AuthorizedUser } from "@/lib/authorization";
import { listClientPortalCredentials } from "@/services/client-portal-credentials.service";
import { listActiveCarriers } from "@/services/policies.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CLIENT_PORTAL_TYPE_LABELS } from "@/lib/labels";
import { CreateClientCredentialForm } from "./create-client-credential-form";
import { ClientCredentialRow } from "./client-credential-row";

// "Accesos" — vault de credenciales de portal del CLIENTE (carrier,
// Marketplace, exchange estatal) — Fase 025 (Parte J). El Server
// Component NUNCA descifra estos valores: listClientPortalCredentials
// solo retorna una máscara fija — el valor completo se pide bajo
// demanda vía Server Action (reveal), nunca cacheado ni precargado
// (mismo principio que IdentityTab, Fase 021).
export async function CredentialsTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const [{ items, canReveal }, carriers] = await Promise.all([
    listClientPortalCredentials(actor, personId),
    listActiveCarriers(actor),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Accesos a portales del cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CreateClientCredentialForm personId={personId} carriers={carriers} />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin accesos registrados.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((cred) => (
              <div key={cred.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{cred.portalName}</span>
                    <Badge variant="outline">{CLIENT_PORTAL_TYPE_LABELS[cred.portalType]}</Badge>
                    {!cred.isActive && <Badge variant="outline">Desactivado</Badge>}
                  </div>
                  <a
                    href={cred.portalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm underline"
                  >
                    Abrir portal
                  </a>
                </div>
                {cred.carrier && (
                  <p className="text-xs text-muted-foreground">Compañía: {cred.carrier.name}</p>
                )}
                <ClientCredentialRow
                  credentialId={cred.id}
                  personId={personId}
                  usernameMasked={cred.usernameMasked}
                  passwordMasked={cred.passwordMasked}
                  canReveal={canReveal}
                  isActive={cred.isActive}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
