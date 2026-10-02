import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getLeadById } from "@/services/leads.service";
import { listActiveAgents } from "@/services/users.service";
import { listActiveProducts } from "@/services/policies.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_FOLLOW_UP_STATUS_LABELS,
  LEAD_FOLLOW_UP_STATUS_BADGE_VARIANT,
  LEAD_CLOSE_REASON_LABELS,
  LEAD_ACTIVITY_TYPE_LABELS,
} from "@/lib/labels";
import { formatDateTimeUS } from "@/lib/business-time";
import { AssignLeadForm } from "./assign-form";
import { LeadStatusActions } from "./lead-status-actions";
import { ActivityForm } from "./activity-form";
import { ConvertForm } from "./convert-form";
import { EditLeadDetailsForm } from "./edit-details-form";
import { FormResponsesView } from "./form-responses-view";

function splitFullNameForPrefill(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function consentLabel(consentGiven: boolean | null): string {
  if (consentGiven === true) return "Autorizó";
  if (consentGiven === false) return "Negó explícitamente";
  return "No especificado por la fuente";
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();
  const { id } = await params;

  let lead: Awaited<ReturnType<typeof getLeadById>>;
  try {
    lead = await getLeadById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a este lead.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/leads" />}>
            Volver
          </Button>
        </div>
      );
    }
    throw error;
  }
  const isTerminal = lead.followUpStatus === "CONVERTED" || lead.followUpStatus === "CLOSED";

  const [activeAgents, products] = await Promise.all([
    actor.role === "ADMIN" ? listActiveAgents(actor) : Promise.resolve([]),
    isTerminal ? Promise.resolve([]) : listActiveProducts(actor, {}),
  ]);

  const pendingTask = lead.tasks.find((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  const { firstName, lastName } = splitFullNameForPrefill(lead.fullName);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{lead.fullName}</h2>
          <p className="text-sm text-muted-foreground">
            {LEAD_SOURCE_LABELS[lead.source]} · Recibido {formatDateTimeUS(lead.receivedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>{LEAD_STAGE_LABELS[lead.stage]}</Badge>
          <Badge variant={LEAD_FOLLOW_UP_STATUS_BADGE_VARIANT[lead.followUpStatus]}>
            {LEAD_FOLLOW_UP_STATUS_LABELS[lead.followUpStatus]}
          </Badge>
        </div>
        <Button variant="ghost" nativeButton={false} render={<Link href="/leads" />}>
          Volver al listado
        </Button>
      </div>

      <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Teléfono</p>
          <p>{lead.phone}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Correo</p>
          <p>{lead.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Estado de residencia</p>
          <p>{lead.residenceState ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Producto de interés</p>
          <p>{lead.productInterest ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Campaña</p>
          <p>{lead.campaignName ?? lead.campaignId ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Autorización de contacto</p>
          <p>{consentLabel(lead.consentGiven)}</p>
        </div>
        {lead.integrationCredential && (
          <div>
            <p className="text-xs text-muted-foreground">Integración</p>
            <p>{lead.integrationCredential.label}</p>
          </div>
        )}
        {lead.createdBy && (
          <div>
            <p className="text-xs text-muted-foreground">Creado por</p>
            <p>{lead.createdBy.name}</p>
          </div>
        )}
        {lead.closeReason && (
          <div>
            <p className="text-xs text-muted-foreground">Motivo de cierre</p>
            <p>
              {LEAD_CLOSE_REASON_LABELS[lead.closeReason]}
              {lead.closeReasonDetail ? ` — ${lead.closeReasonDetail}` : ""}
            </p>
          </div>
        )}
      </section>

      <EditLeadDetailsForm
        leadId={lead.id}
        fullName={lead.fullName}
        phone={lead.phone}
        email={lead.email}
        residenceState={lead.residenceState}
        productInterest={lead.productInterest}
      />

      <FormResponsesView formResponses={lead.formResponses} />

      {lead.linkedPerson ? (
        <section className="rounded-md border p-4">
          <h3 className="mb-2 text-sm font-medium">Contacto vinculado</h3>
          <Link href={`/contacts/${lead.linkedPerson.id}`} className="underline">
            {lead.linkedPerson.firstName} {lead.linkedPerson.lastName}
          </Link>
          <p className="text-sm text-muted-foreground">
            Agente actual del contacto: {lead.linkedPerson.assignedAgent?.name ?? "Sin asignar"}
          </p>
          {lead.convertedPolicy && (
            <p className="text-sm text-muted-foreground">
              Póliza:{" "}
              <Link href={`/policies/${lead.convertedPolicy.id}`} className="underline">
                {lead.convertedPolicy.policyNumber ?? "Sin número asignado"}
              </Link>{" "}
              ({lead.convertedPolicy.status})
            </p>
          )}
        </section>
      ) : (
        lead.personMatches.length > 0 && (
          <section className="rounded-md border border-amber-400/60 bg-amber-50/50 p-4 dark:bg-amber-950/20">
            <h3 className="mb-2 text-sm font-medium">
              {lead.personMatches.length === 1 ? "Posible coincidencia por teléfono" : "Coincidencia ambigua por teléfono"}
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {lead.personMatches.map((p) => (
                <li key={p.id}>
                  <Link href={`/contacts/${p.id}`} className="underline">
                    {p.firstName} {p.lastName}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {lead.relatedLeads.length > 0 && (
        <section className="rounded-md border p-4">
          <h3 className="mb-2 text-sm font-medium">Otras consultas con el mismo teléfono</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {lead.relatedLeads.map((rl) => (
              <li key={rl.id}>
                <Link href={`/leads/${rl.id}`} className="underline">
                  {rl.fullName}
                </Link>{" "}
                — {formatDateTimeUS(rl.receivedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {actor.role === "ADMIN" && (
        <section className="rounded-md border p-4">
          <h3 className="mb-2 text-sm font-medium">Asignación</h3>
          <AssignLeadForm
            leadId={lead.id}
            currentAssignedToId={lead.assignedToId}
            hasPendingTask={Boolean(pendingTask)}
            activeAgents={activeAgents}
          />
        </section>
      )}

      <section className="rounded-md border p-4">
        <h3 className="mb-2 text-sm font-medium">Etapa y seguimiento</h3>
        <LeadStatusActions leadId={lead.id} stage={lead.stage} followUpStatus={lead.followUpStatus} />
      </section>

      {!isTerminal && (
        <ConvertForm
          leadId={lead.id}
          candidates={lead.personMatches}
          defaultFirstName={firstName}
          defaultLastName={lastName}
          defaultPhone={lead.phone}
          defaultEmail={lead.email ?? undefined}
          products={products.map((p) => ({ id: p.id, name: p.name, carrierName: p.carrier.name }))}
        />
      )}

      <ActivityForm leadId={lead.id} />

      <section className="rounded-md border p-4">
        <h3 className="mb-2 text-sm font-medium">Historial de actividades</h3>
        {lead.activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividades registradas.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {lead.activities.map((a) => (
              <li key={a.id} className="border-b pb-2 last:border-0">
                <span className="font-medium">{LEAD_ACTIVITY_TYPE_LABELS[a.type]}</span> — {formatDateTimeUS(a.occurredAt)} ({a.author.name})
                {a.outcome && <p className="text-muted-foreground">{a.outcome}</p>}
                {a.note && <p className="text-muted-foreground">{a.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border p-4">
        <h3 className="mb-2 text-sm font-medium">Historial de asignaciones</h3>
        {lead.assignmentHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin reasignaciones todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {lead.assignmentHistory.map((h) => (
              <li key={h.id}>
                {formatDateTimeUS(h.assignedAt)}: {h.previousAgent?.name ?? "Sin asignar"} → {h.newAgent?.name ?? "Sin asignar"} (por {h.assignedBy.name})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border p-4">
        <h3 className="mb-2 text-sm font-medium">Tareas vinculadas</h3>
        {lead.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin tareas vinculadas.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {lead.tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="underline">
                  {t.title}
                </Link>{" "}
                — {t.status} ({t.assignedTo?.name ?? "Sin asignar"})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
