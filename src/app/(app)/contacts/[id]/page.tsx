import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPersonById } from "@/services/people.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CONTACT_STATUS_BADGE_VARIANT,
  CONTACT_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_BADGE_VARIANT,
} from "@/lib/labels";
import { getBirthdayForPerson } from "@/services/birthdays.service";
import { getHouseholdsForPerson } from "@/services/households.service";
import { FamilyTab } from "./family-tab";
import { PoliciesTab } from "./policies-tab";
import { TasksTab } from "./tasks-tab";
import { HealthTab } from "./health-tab";
import { CommissionsTab } from "./commissions-tab";
import { NotesTab } from "./notes-tab";
import { MarkSentDialog } from "../../birthdays/mark-sent-dialog";
import { SkipGreetingButton } from "../../birthdays/greeting-quick-buttons";

const PROFILE_TABS = [
  { key: "resumen", label: "Resumen", enabled: true },
  { key: "familia", label: "Familia", enabled: true },
  { key: "polizas", label: "Pólizas", enabled: true },
  { key: "salud", label: "Salud", enabled: true },
  { key: "tareas", label: "Tareas", enabled: true },
  { key: "comisiones", label: "Comisiones", enabled: true },
  { key: "notas", label: "Notas", enabled: true },
] as const;

function formatMoney(amount: { toFixed: (n: number) => string } | null | undefined): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const actor = await requireUser();

  // Comisiones es FINANCIERO/RESTRINGIDO (Fase 016) — se oculta por
  // completo para ASSISTANT, no solo se deshabilita, para evitar
  // confusión y para no dejar una pestaña "viva" apuntando a datos que
  // de todas formas el servicio rechazaría.
  const visibleTabs =
    actor.role === "ASSISTANT" ? PROFILE_TABS.filter((t) => t.key !== "comisiones") : PROFILE_TABS;
  const activeTab = visibleTabs.some((t) => t.key === rawTab && t.enabled) ? rawTab! : "resumen";

  let person;
  try {
    person = await getPersonById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  const birthday = person.dateOfBirth ? await getBirthdayForPerson(actor, person.id) : null;
  const households = activeTab === "resumen" ? await getHouseholdsForPerson(actor, person.id) : [];
  const primaryHousehold = households[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {person.firstName} {person.lastName}
          </h2>
          <Badge variant={CONTACT_STATUS_BADGE_VARIANT[person.contactStatus]}>
            {CONTACT_STATUS_LABELS[person.contactStatus]}
          </Badge>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/contacts/${person.id}/edit`} />}
        >
          Editar
        </Button>
      </div>

      {/* Tabs por query param (?tab=): compartibles/navegables sin JS.
          Solo "Resumen" y "Familia" tienen contenido en esta fase. */}
      <div className="flex flex-wrap gap-1 border-b">
        {visibleTabs.map((tab) => {
          const isActive = tab.key === activeTab;
          if (!tab.enabled) {
            return (
              <span
                key={tab.key}
                className="cursor-not-allowed px-3 py-2 text-sm text-muted-foreground/50"
                title="Disponible próximamente"
              >
                {tab.label}
              </span>
            );
          }
          return (
            <Link
              key={tab.key}
              href={tab.key === "resumen" ? `/contacts/${id}` : `/contacts/${id}?tab=${tab.key}`}
              className={
                isActive
                  ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium"
                  : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {activeTab === "familia" ? (
        <FamilyTab actor={actor} personId={person.id} />
      ) : activeTab === "polizas" ? (
        <PoliciesTab actor={actor} personId={person.id} />
      ) : activeTab === "tareas" ? (
        <TasksTab actor={actor} personId={person.id} />
      ) : activeTab === "salud" ? (
        <HealthTab actor={actor} personId={person.id} />
      ) : activeTab === "comisiones" ? (
        actor.role === "ASSISTANT" ? null : <CommissionsTab actor={actor} personId={person.id} />
      ) : activeTab === "notas" ? (
        <NotesTab actor={actor} personId={person.id} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Datos personales
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Teléfono</span>
                <span>{person.phone ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Email</span>
                <span>{person.email ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Fecha de nacimiento</span>
                <span>{formatDate(person.dateOfBirth)}</span>
              </div>
              {birthday && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Felicitación {birthday.year}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={BIRTHDAY_GREETING_STATUS_BADGE_VARIANT[birthday.greeting.status]}>
                      {BIRTHDAY_GREETING_STATUS_LABELS[birthday.greeting.status]}
                    </Badge>
                    <MarkSentDialog
                      personId={person.id}
                      personName={`${person.firstName} ${person.lastName}`}
                    />
                    <SkipGreetingButton personId={person.id} />
                  </div>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Agente asignado</span>
                <span>{person.assignedAgent?.name ?? "Sin asignar"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Resumen relacionado
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Hogares</span>
                <span>{person._count.householdMembers}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Pólizas</span>
                <span>{person._count.holderPolicies}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Tareas</span>
                <span>{person._count.tasks}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Notas</span>
                <span>{person._count.notes}</span>
              </div>
            </CardContent>
          </Card>

          {primaryHousehold && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Hogar</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Dirección</span>
                  <span className="text-right">
                    {primaryHousehold.addressLine1
                      ? `${primaryHousehold.addressLine1}${primaryHousehold.addressLine2 ? `, ${primaryHousehold.addressLine2}` : ""}`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Ciudad/Estado/ZIP</span>
                  <span>
                    {[primaryHousehold.city, primaryHousehold.state, primaryHousehold.zipCode]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Condado</span>
                  <span>{primaryHousehold.county ?? "—"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Ingreso familiar estimado</span>
                  <span>{formatMoney(primaryHousehold.annualHouseholdIncome)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Año del ingreso</span>
                  <span>{primaryHousehold.incomeYear ?? "—"}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
