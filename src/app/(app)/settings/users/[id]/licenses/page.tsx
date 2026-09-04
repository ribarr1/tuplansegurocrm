import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listAgentLicenses } from "@/services/agent-licenses.service";
import { listAllUsers } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnlyUS } from "@/lib/date-only";
import { CreateLicenseForm } from "./create-license-form";
import { ToggleLicenseStatusButton } from "./toggle-license-status-button";

const LICENSE_STATUS_BADGE: Record<string, "default" | "outline" | "destructive"> = {
  ACTIVE: "default",
  INACTIVE: "outline",
  EXPIRED: "destructive",
};

const LICENSE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  INACTIVE: "Inactiva",
  EXPIRED: "Expirada",
};

export default async function AgentLicensesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();

  let licenses;
  try {
    licenses = await listAgentLicenses(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a las licencias de este usuario.</p>
        </div>
      );
    }
    throw error;
  }

  // ADMIN puede administrar cualquier usuario — se resuelve el nombre
  // aquí (listAgentLicenses ya validó acceso) solo para el título.
  const users = actor.role === "ADMIN" ? await listAllUsers(actor) : [];
  const targetUser = users.find((u) => u.id === id);
  if (actor.role === "ADMIN" && !targetUser) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">
          Licencias de agente{targetUser ? ` — ${targetUser.name}` : ""}
        </h2>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/users" />}>
          Volver a Usuarios
        </Button>
      </div>

      {actor.role === "ADMIN" && <CreateLicenseForm userId={id} />}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado (US)</TableHead>
              <TableHead>Estatus</TableHead>
              <TableHead>Número de licencia</TableHead>
              <TableHead>Vigencia</TableHead>
              {actor.role === "ADMIN" && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {licenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Sin licencias registradas.
                </TableCell>
              </TableRow>
            ) : (
              licenses.map((license) => (
                <TableRow key={license.id}>
                  <TableCell className="font-medium">{license.state}</TableCell>
                  <TableCell>
                    <Badge variant={LICENSE_STATUS_BADGE[license.status]}>
                      {LICENSE_STATUS_LABEL[license.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{license.licenseNumber ?? "—"}</TableCell>
                  <TableCell>
                    {license.effectiveDate ? formatDateOnlyUS(license.effectiveDate) : "—"}
                    {license.expirationDate ? ` – ${formatDateOnlyUS(license.expirationDate)}` : ""}
                  </TableCell>
                  {actor.role === "ADMIN" && (
                    <TableCell className="text-right">
                      <ToggleLicenseStatusButton
                        licenseId={license.id}
                        userId={id}
                        status={license.status}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
