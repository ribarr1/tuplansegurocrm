import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const actor = await requireUser();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Configuración</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {actor.role === "ADMIN" && (
          <Link href="/settings/users">
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle>Usuarios</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Administra los usuarios del CRM: agentes, asistentes y administradores.
              </CardContent>
            </Card>
          </Link>
        )}

        <Link href="/settings/carriers">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle>Compañías</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Administra las aseguradoras (carriers) disponibles para crear pólizas.
            </CardContent>
          </Card>
        </Link>

        <Link href="/settings/products">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle>Productos</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Administra los productos/planes de cada compañía y su tipo de seguro.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
