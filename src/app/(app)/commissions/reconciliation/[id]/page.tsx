import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getCommissionStatementPreview } from "@/services/commission-statements/reconciliation.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnlyUS } from "@/lib/date-only";
import { MatchRowDialog } from "./match-row-dialog";
import { IgnoreRowButton } from "./ignore-row-button";
import { ApplyStatementButton } from "./apply-button";

const REVIEW_STATE_LABELS: Record<string, string> = {
  MATCH: "Coincide",
  UNDERPAID: "Pagado de menos",
  OVERPAID: "Pagado de más",
  NO_EXPECTATION: "Sin expectativa",
  UNMATCHED: "Sin emparejar",
  AMBIGUOUS: "Ambiguo",
  IGNORED: "Ignorado",
};

const REVIEW_STATE_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  MATCH: "default",
  UNDERPAID: "destructive",
  OVERPAID: "secondary",
  NO_EXPECTATION: "outline",
  UNMATCHED: "outline",
  AMBIGUOUS: "outline",
  IGNORED: "outline",
};

export default async function ReconciliationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { id } = await params;
  const { duplicate } = await searchParams;
  const actor = await requireUser();
  if (actor.role !== "ADMIN") forbidden();

  let preview;
  try {
    preview = await getCommissionStatementPreview(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.code === "FORBIDDEN") forbidden();
    throw error;
  }

  const { statement, rows } = preview;
  const pendingCount = rows.filter((r) => r.matchStatus === "MATCHED" && !r.alreadyApplied).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{statement.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {statement.source} · {statement.totalRows} filas · Total declarado: ${statement.receivedTotal.toString()}
          </p>
        </div>
        <Link href="/commissions/reconciliation" className="text-sm underline">
          Volver al historial
        </Link>
      </div>

      {duplicate === "1" && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Este contenido ya se había subido antes (mismo archivo, posiblemente con otro nombre) — te mostramos el
          reporte existente en vez de crear uno nuevo.
        </p>
      )}

      {statement.status === "APPLIED" ? (
        <p className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
          Este reporte ya fue aplicado el {statement.appliedAt ? formatDateOnlyUS(statement.appliedAt) : "—"}.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <ApplyStatementButton statementId={statement.id} pendingCount={pendingCount} />
          {pendingCount === 0 && (
            <span className="text-xs text-muted-foreground">
              No hay filas emparejadas listas para aplicar todavía.
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Filas del reporte</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">External ID</th>
                <th className="py-2 pr-3">Póliza emparejada</th>
                <th className="py-2 pr-3">Esperado</th>
                <th className="py-2 pr-3">Recibido</th>
                <th className="py-2 pr-3">Diferencia</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{row.displayName ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{row.externalId ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {row.matchedPolicy ? (
                      <Link href={`/policies/${row.matchedPolicy.id}`} className="underline">
                        {row.matchedPolicy.holder.firstName} {row.matchedPolicy.holder.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3">{row.expectedAmount ? `$${row.expectedAmount.toString()}` : "—"}</td>
                  <td className="py-2 pr-3">${row.receivedAmount.toString()}</td>
                  <td className="py-2 pr-3">{row.difference ? `$${row.difference}` : "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={REVIEW_STATE_VARIANT[row.reviewState] ?? "outline"}>
                      {REVIEW_STATE_LABELS[row.reviewState] ?? row.reviewState}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {row.alreadyApplied ? (
                      <span className="text-xs text-muted-foreground">Aplicado</span>
                    ) : row.matchStatus === "UNMATCHED" || row.matchStatus === "AMBIGUOUS" ? (
                      <div className="flex items-center gap-2">
                        <MatchRowDialog
                          rowId={row.id}
                          rowLabel={`${row.displayName ?? "Sin nombre"} — $${row.receivedAmount.toString()}`}
                        />
                        <IgnoreRowButton rowId={row.id} />
                      </div>
                    ) : row.matchStatus === "IGNORED" ? (
                      <span className="text-xs text-muted-foreground">Ignorada</span>
                    ) : (
                      <IgnoreRowButton rowId={row.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
