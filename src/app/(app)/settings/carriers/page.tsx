import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listCarriers } from "@/services/carriers.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleCarrierActiveButton } from "./toggle-active-button";

type SearchParams = { active?: string };

export default async function CarriersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const active = sp.active === "true" || sp.active === "false" ? sp.active : undefined;

  const carriers = await listCarriers(actor, { active });
  const isAdmin = actor.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Compañías</h2>
        {isAdmin && (
          <Button nativeButton={false} render={<Link href="/settings/carriers/new" />}>
            + Nueva compañía
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b text-sm">
        <Link
          href="/settings/carriers"
          className={!active ? "border-b-2 border-foreground px-3 py-2 font-medium" : "px-3 py-2 text-muted-foreground"}
        >
          Todas
        </Link>
        <Link
          href="/settings/carriers?active=true"
          className={active === "true" ? "border-b-2 border-foreground px-3 py-2 font-medium" : "px-3 py-2 text-muted-foreground"}
        >
          Activas
        </Link>
        <Link
          href="/settings/carriers?active=false"
          className={active === "false" ? "border-b-2 border-foreground px-3 py-2 font-medium" : "px-3 py-2 text-muted-foreground"}
        >
          Inactivas
        </Link>
      </div>

      {carriers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay compañías todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead># Productos</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carriers.map((carrier) => (
                <TableRow key={carrier.id}>
                  <TableCell className="font-medium">{carrier.name}</TableCell>
                  <TableCell>
                    <Badge variant={carrier.isActive ? "default" : "outline"}>
                      {carrier.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell>{carrier._count.products}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/settings/carriers/${carrier.id}/edit`} />}
                        >
                          Editar
                        </Button>
                        <ToggleCarrierActiveButton
                          carrierId={carrier.id}
                          isActive={carrier.isActive}
                        />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
