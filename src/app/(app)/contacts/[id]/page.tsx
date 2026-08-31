import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPersonById } from "@/services/people.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTACT_STATUS_BADGE_VARIANT, CONTACT_STATUS_LABELS } from "@/lib/labels";
import { FamilyTab } from "./family-tab";
import { PoliciesTab } from "./policies-tab";

const PROFILE_TABS = [
  { key: "resumen", label: "Resumen", enabled: true },
  { key: "familia", label: "Familia", enabled: true },
  { key: "polizas", label: "Pólizas", enabled: true },
  { key: "salud", label: "Salud", enabled: false },
  { key: "tareas", label: "Tareas", enabled: false },
  { key: "comisiones", label: "Comisiones", enabled: false },
  { key: "notas", label: "Notas", enabled: false },
] as const;

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

  const activeTab = PROFILE_TABS.some((t) => t.key === rawTab && t.enabled) ? rawTab! : "resumen";

  let person;
  try {
    person = await getPersonById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

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
        {PROFILE_TABS.map((tab) => {
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
        </div>
      )}
    </div>
  );
}
