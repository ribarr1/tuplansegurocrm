import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Menú de reportes — Fase 021 (§41). Clientes tiene página propia
// (reporte operativo real, distinto del listado básico de Contactos);
// Pólizas y Comisiones reutilizan sus listados existentes, que ya
// sirven como reporte (ver docs/DECISIONS.md — "no crear página
// duplicada si ya sirve como reporte").
export default async function ReportsPage() {
  const actor = await requireUser();
  const showCommissions = actor.role !== "ASSISTANT";

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Reportes</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/reports/clients">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Clientes</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Listado operativo de cartera con filtros por estado, agente, ubicación, categoría
              migratoria y pólizas.
            </CardContent>
          </Card>
        </Link>
        <Link href="/policies">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Pólizas</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Listado de pólizas con filtros por estado, tipo, compañía y agente.
            </CardContent>
          </Card>
        </Link>
        {showCommissions && (
          <Link href="/commissions">
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Comisiones</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Esperado vs. recibido, diferencia y estado por período, agente y póliza.
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
