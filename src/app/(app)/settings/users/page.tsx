import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listAllUsers } from "@/services/users.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/labels";
import { CreateUserForm } from "./create-user-form";
import { ToggleUserActiveButton } from "./toggle-active-button";
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
      <h2 className="text-lg font-semibold">Usuarios</h2>

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
                <TableCell className="text-right">
                  <ToggleUserActiveButton userId={user.id} isActive={user.isActive} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
