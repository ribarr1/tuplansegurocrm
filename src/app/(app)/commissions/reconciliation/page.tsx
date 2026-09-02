import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listCommissionStatements } from "@/services/commission-statements/reconciliation.service";
import { listStatementSources } from "@/services/commission-statements/registry";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeUS } from "@/lib/business-time";
import { UploadStatementForm } from "./upload-form";

const STATUS_LABELS: Record<string, string> = {
  PREVIEW: "En revisión",
  APPLIED: "Aplicado",
  DUPLICATE_BLOCKED: "Bloqueado (duplicado)",
};

// Conciliación de comisiones — Fase 020 (§7-§26 de la ficha). Solo
// ADMIN — ver docs/COMMISSION_RECONCILIATION.md.
export default async function ReconciliationPage() {
  const actor = await requireUser();
  if (actor.role !== "ADMIN") forbidden();

  let statements;
  try {
    statements = await listCommissionStatements(actor);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") forbidden();
    throw error;
  }

  const sources = listStatementSources();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Conciliar pagos de comisiones</h2>
        <Button variant="ghost" nativeButton={false} render={<Link href="/commissions" />}>
          Volver a Comisiones
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Nuevo reporte</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadStatementForm sources={sources} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Historial de reportes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {statements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha subido ningún reporte.</p>
          ) : (
            statements.map((s) => (
              <Link
                key={s.id}
                href={`/commissions/reconciliation/${s.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-muted"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {s.fileName} · {s.source}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTimeUS(s.uploadedAt)} · {s.uploadedBy?.name ?? "—"} · {s.totalRows} filas ·{" "}
                    {s.matchedRows} emparejadas · {s.unmatchedRows} sin emparejar · {s.ambiguousRows} ambiguas
                  </span>
                </div>
                <Badge variant={s.status === "APPLIED" ? "default" : "outline"}>
                  {STATUS_LABELS[s.status] ?? s.status}
                </Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
