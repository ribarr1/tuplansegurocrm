import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listAllUsers } from "@/services/users.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/labels";
import { CreateUserForm } from "./create-user-form";
import { ToggleUserActiveButton } from "./toggle-active-button";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { formatDateUS } from "@/lib/business-time";

const formatDate = formatDateUS;

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
              <TableHead>Estado</TableHead>
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
                  <Badge variant={user.isActive ? "default" : "outline"}>
                    {user.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell className="flex justify-end gap-2 text-right">
                  <Link href={`/settings/users/${user.id}/activity`} className="text-sm underline">
                    Ver actividad
                  </Link>
                  {(user.role === "AGENT" || user.role === "ADMIN") && (
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
                  <ResetPasswordDialog userId={user.id} userName={user.name} />
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
