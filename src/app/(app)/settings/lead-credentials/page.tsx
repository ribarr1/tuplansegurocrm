import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listLeadCredentials } from "@/services/lead-credentials.service";
import { listFailedWebhookEvents } from "@/services/lead-webhook-events.service";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeUS } from "@/lib/business-time";
import { CredentialForm } from "./credential-form";
import { RevokeCredentialButton } from "./revoke-button";
import { ConnectorConfigForm } from "./connector-config-form";
import { FieldMappingForm } from "./field-mapping-form";
import { FailedWebhookEvents } from "./failed-webhook-events";

export default async function LeadCredentialsPage() {
  const actor = await requireUser();
  if (actor.role !== "ADMIN") forbidden();

  const [credentials, failedEvents] = await Promise.all([
    listLeadCredentials(actor),
    listFailedWebhookEvents(actor),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Credenciales de integración — Leads</h2>
      <p className="text-sm text-muted-foreground">
        Cada integración externa (Google, Meta, un formulario web) usa su propia credencial para enviar leads a{" "}
        <code>POST /api/leads/intake</code>. El secreto solo se muestra una vez, al crearla.
      </p>

      <CredentialForm />

      {credentials.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay credenciales todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etiqueta</TableHead>
                <TableHead>Fuente</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Conector</TableHead>
                <TableHead>Creada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.label}</TableCell>
                  <TableCell>{c.source}</TableCell>
                  <TableCell className="font-mono text-xs">{c.credentialKey}</TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "Activa" : "Revocada"}</Badge>
                  </TableCell>
                  <TableCell>
                    {(c.source === "GOOGLE" || c.source === "META") && c.isActive ? (
                      <div className="flex flex-col items-end gap-2">
                        <ConnectorConfigForm credentialId={c.id} source={c.source} hasConnectorSecrets={c.hasConnectorSecrets} />
                        <FieldMappingForm credentialId={c.id} source={c.source} currentMapping={c.customFieldMapping} />
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{formatDateTimeUS(c.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {c.isActive && <RevokeCredentialButton id={c.id} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Eventos de webhook fallidos / pendientes de revisión</h3>
        <FailedWebhookEvents
          events={failedEvents.map((e) => ({ ...e, receivedAtLabel: formatDateTimeUS(e.receivedAt) }))}
        />
      </section>
    </div>
  );
}
