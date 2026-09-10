import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listAllUsers } from "@/services/users.service";
import { getInvitationStatuses, type InvitationStatus } from "@/services/user-invitations.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/labels";
import { CreateUserForm } from "./create-user-form";
import { ToggleUserActiveButton } from "./toggle-active-button";
import { ToggleUserIsAgentButton } from "./toggle-is-agent-button";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { ResendInvitationButton } from "./resend-invitation-button";
import { formatDateUS } from "@/lib/business-time";

const formatDate = formatDateUS;

// CORRECCIÓN (activación de usuarios) — concepto DISTINTO de
// isActive/Inactivo (ver comentario en el modelo User): si esta cuenta
// ya estableció su propia contraseña por invitación.
const ACTIVATION_LABEL: Record<InvitationStatus, string> = {
  PENDING: "Pendiente de activación",
  EXPIRED: "Invitación vencida",
  ACTIVATED: "Activo",
};
const ACTIVATION_VARIANT: Record<InvitationStatus, "default" | "outline" | "destructive"> = {
  PENDING: "outline",
  EXPIRED: "destructive",
  ACTIVATED: "default",
};

export default async function UsersPage() {
  const actor = await requireUser();

  if (actor.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">Solo un administrador puede administrar usuarios.</p>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings" />}>
          Volver
        </Button>
      </div>
    );
  }

  const users = await listAllUsers(actor);
  const invitationStatuses = await getInvitationStatuses(users);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Usuarios</h2>

      <CreateUserForm />

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Agente</TableHead>
              <TableHead>Habilitado</TableHead>
              <TableHead>Activación</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                <TableCell>
                  {user.isAgent ? (
                    <Badge variant="secondary">Agente</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? "default" : "outline"}>
                    {user.isActive ? "Habilitado" : "Deshabilitado"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {(() => {
                    const activation = invitationStatuses.get(user.id) ?? "ACTIVATED";
                    return (
                      <Badge variant={ACTIVATION_VARIANT[activation]}>{ACTIVATION_LABEL[activation]}</Badge>
                    );
                  })()}
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2 text-right">
                  <Link href={`/settings/users/${user.id}/activity`} className="text-sm underline">
                    Ver actividad
                  </Link>
                  {(user.role === "AGENT" || user.isAgent) && (
                    <>
                      <Link href={`/settings/users/${user.id}/licenses`} className="text-sm underline">
                        Licencias
                      </Link>
                      <Link href={`/settings/users/${user.id}/contracts`} className="text-sm underline">
                        Contratos
                      </Link>
                      <Link href={`/settings/users/${user.id}/credentials`} className="text-sm underline">
                        Accesos
                      </Link>
                    </>
                  )}
                  {(invitationStatuses.get(user.id) ?? "ACTIVATED") !== "ACTIVATED" && (
                    <ResendInvitationButton userId={user.id} />
                  )}
                  <ResetPasswordDialog userId={user.id} userName={user.name} />
                  <ToggleUserIsAgentButton userId={user.id} role={user.role} isAgent={user.isAgent} />
                  <ToggleUserActiveButton
                    userId={user.id}
                    isActive={user.isActive}
                    isSelf={user.id === actor.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
