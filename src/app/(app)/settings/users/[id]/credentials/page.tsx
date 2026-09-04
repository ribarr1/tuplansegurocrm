import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listAgentPortalCredentials } from "@/services/agent-portal-credentials.service";
import { listActiveCarriers } from "@/services/policies.service";
import { listAllUsers } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateCredentialForm } from "./create-credential-form";
import { CredentialRow } from "./credential-row";

export default async function AgentCredentialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();

  let credentials;
  try {
    credentials = await listAgentPortalCredentials(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a los accesos de este usuario.</p>
        </div>
      );
    }
    throw error;
  }

  const [users, carriers] = await Promise.all([
    actor.role === "ADMIN" ? listAllUsers(actor) : Promise.resolve([]),
    listActiveCarriers(actor),
  ]);
  const targetUser = users.find((u) => u.id === id);
  if (actor.role === "ADMIN" && !targetUser) notFound();

  // ADMIN puede revelar cualquiera; AGENT solo las propias — el
  // servicio ya lo garantiza, esto solo decide si mostrar el botón
  // "Mostrar" (canAccess ya lo validó al listar, así que si llegamos
  // aquí el actor puede al menos ver esta lista).
  const canReveal = actor.role === "ADMIN" || actor.id === id;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">
          Accesos a portales de agente{targetUser ? ` — ${targetUser.name}` : ""}
        </h2>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/users" />}>
          Volver a Usuarios
        </Button>
      </div>

      <CreateCredentialForm userId={id} carriers={carriers} />

      {credentials.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin accesos registrados.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {credentials.map((cred) => (
            <div key={cred.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{cred.portalName}</span>
                <div className="flex items-center gap-2">
                  {!cred.isActive && <Badge variant="outline">Desactivado</Badge>}
                  <a
                    href={cred.portalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm underline"
                  >
                    Abrir portal
                  </a>
                </div>
              </div>
              {cred.carrier && <p className="text-xs text-muted-foreground">Compañía: {cred.carrier.name}</p>}
              <CredentialRow
                credentialId={cred.id}
                userId={id}
                usernameMasked={cred.usernameMasked}
                passwordMasked={cred.passwordMasked}
                canReveal={canReveal}
                isActive={cred.isActive}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
