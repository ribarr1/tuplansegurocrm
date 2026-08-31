import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPersonById } from "@/services/people.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTACT_STATUS_BADGE_VARIANT, CONTACT_STATUS_LABELS } from "@/lib/labels";

const PROFILE_TABS = ["Resumen", "Familia", "Pólizas", "Salud", "Tareas", "Comisiones", "Notas"];

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

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

      {/* Tabs preparados visualmente; solo "Resumen" funciona en esta fase. */}
      <div className="flex flex-wrap gap-1 border-b">
        {PROFILE_TABS.map((tab, i) => (
          <span
            key={tab}
            className={
              i === 0
                ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium"
                : "cursor-not-allowed px-3 py-2 text-sm text-muted-foreground/50"
            }
            title={i === 0 ? undefined : "Disponible próximamente"}
          >
            {tab}
          </span>
        ))}
      </div>

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
    </div>
  );
}
