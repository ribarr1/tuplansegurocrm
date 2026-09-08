import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getCommissionStatementPreview } from "@/services/commission-statements/reconciliation.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnlyUS } from "@/lib/date-only";
import { formatPeriodUS } from "@/lib/business-time";
import { MatchRowDialog } from "./match-row-dialog";
import { IgnoreRowButton } from "./ignore-row-button";
import { ApplyStatementButton } from "./apply-button";

// Fase 025.5.5 (UAT-21): dos dimensiones SEPARADAS, nunca un solo
// badge — una fila puede ser simultáneamente Importación="Lista para
// aplicar" y Conciliación="Sin expectativa"; mezclarlas en un solo
// estado (como antes) hacía parecer que esas filas no podían aplicarse.
const IMPORT_STATUS_LABELS: Record<string, string> = {
  READY: "Lista para aplicar",
  APPLIED: "Aplicada",
  UNMATCHED: "No encontrada",
  AMBIGUOUS: "Ambigua",
  IGNORED: "Ignorada",
  DUPLICATE: "Duplicada",
  INVALID: "Inválida",
};

const IMPORT_STATUS_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  READY: "default",
  APPLIED: "secondary",
  UNMATCHED: "outline",
  AMBIGUOUS: "outline",
  IGNORED: "outline",
  DUPLICATE: "outline",
  INVALID: "destructive",
};

// Solo tiene sentido para filas con una póliza emparejada (READY o
// APPLIED) — el resto no tiene nada que conciliar todavía.
const RECONCILIATION_STATE_LABELS: Record<string, string> = {
  NO_EXPECTATION: "Sin expectativa",
  MATCH: "Conciliada",
  UNDERPAID: "Pagado de menos",
  OVERPAID: "Pagado de más",
};

const RECONCILIATION_STATE_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  NO_EXPECTATION: "outline",
  MATCH: "default",
  UNDERPAID: "destructive",
  OVERPAID: "secondary",
};

const STATEMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Pendiente de revisión",
  PARTIALLY_APPLIED: "Aplicado parcialmente",
  COMPLETED: "Completado",
  CLOSED_WITH_SKIPPED_ROWS: "Cerrado (con filas omitidas)",
  APPLIED: "Completado",
  PREVIEW: "Pendiente de revisión",
  DUPLICATE_BLOCKED: "Bloqueado (duplicado)",
};

const PAYER_AGENCY_LABELS: Record<string, string> = { ORANGE: "Orange", ELITE: "Elite" };
const BUSINESS_MODALITY_LABELS: Record<string, string> = { OWN: "Propia", REFERRAL: "Referida" };

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

  const { statement, rows, integrityError, applyBatches } = preview;
  // Fase 025.5.5 (UAT-21): "lista para aplicar" es SIEMPRE
  // importStatus === "READY" — nunca depende de si ya tiene expectativa
  // (eso es conciliación, un eje aparte, ver reviewState abajo).
  const readyCount = rows.filter((r) => r.importStatus === "READY").length;
  const importStatusCounts: Record<string, number> = {};
  for (const row of rows) importStatusCounts[row.importStatus] = (importStatusCounts[row.importStatus] ?? 0) + 1;
  const reconciliationCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.importStatus === "READY" || row.importStatus === "APPLIED") {
      reconciliationCounts[row.reviewState] = (reconciliationCounts[row.reviewState] ?? 0) + 1;
    }
  }

  // Fase 025.5.5 (UAT-21): "cerrado definitivamente" — ya no queda
  // ninguna fila accionable (COMPLETED/CLOSED_WITH_SKIPPED_ROWS son los
  // estados nuevos; APPLIED se conserva solo para statements aplicados
  // en una sola pasada ANTES de esta fase, tratado igual que COMPLETED
  // para no ocultar el botón retroactivamente si de algún modo quedara
  // una fila lista). DUPLICATE_BLOCKED bloquea todo, incluida la
  // consulta normal.
  const isClosed = statement.status === "COMPLETED" || statement.status === "CLOSED_WITH_SKIPPED_ROWS";
  const isDuplicateBlocked = statement.status === "DUPLICATE_BLOCKED";
  // Motivo exacto por el que NO se muestra el botón — nunca "no aparece
  // sin explicación" (ver ficha UAT-21, "Lógica del botón").
  const hideReason: string | null = isDuplicateBlocked
    ? "closed"
    : integrityError
      ? "integrity"
      : statement.carrierRecognized === false
        ? "carrier"
        : statement.footerAmbiguous
          ? "footer"
          : isClosed && readyCount === 0
            ? "closed"
            : readyCount === 0
              ? "zero_ready"
              : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{statement.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {statement.source} · {statement.totalRows} filas
            {statement.payerAgency && ` · ${PAYER_AGENCY_LABELS[statement.payerAgency] ?? statement.payerAgency}`}
            {statement.businessModality &&
              ` (${BUSINESS_MODALITY_LABELS[statement.businessModality] ?? statement.businessModality})`}
          </p>
        </div>
        <Link href="/commissions/reconciliation" className="text-sm underline">
          Volver al historial
        </Link>
      </div>

      {(statement.payerAgency || statement.businessModality) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Totales del reporte</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {/* Agencia, modalidad y carrier son 3 datos SEPARADOS —
                agencia+modalidad vienen del selector del ADMIN, el
                carrier se detecta del contenido del PDF (nunca al
                revés). */}
            <span>
              Carrier detectado:{" "}
              <strong>{statement.detectedCarrierName ?? "no detectado"}</strong>
              {statement.carrierRecognized === true && (
                <Badge variant="default" className="ml-2">
                  Reconocido
                </Badge>
              )}
              {statement.carrierRecognized === false && (
                <Badge variant="destructive" className="ml-2">
                  No reconocido — bloquea el apply
                </Badge>
              )}
            </span>
            <span>
              Subtotal bruto: <strong>${statement.receivedTotal.toString()}</strong>
            </span>
            <span>
              Asistencia: <strong>${statement.assistanceTotal.toString()}</strong>
            </span>
            <span>
              Neto: <strong>${statement.netTotal.toString()}</strong>
            </span>
            <span>
              Total declarado en el pie:{" "}
              <strong>
                {statement.footerAmbiguous
                  ? "Total general no verificable"
                  : statement.declaredFooterTotal
                    ? `$${statement.declaredFooterTotal.toString()}`
                    : "no detectado"}
              </strong>
              {statement.footerAmbiguous && (
                <Badge variant="destructive" className="ml-2">
                  Ambiguo — bloquea el apply
                </Badge>
              )}
              {statement.footerMatchesNet === true && (
                <Badge variant="default" className="ml-2">
                  Coincide con el neto
                </Badge>
              )}
              {statement.footerMatchesNet === false && (
                <Badge variant="destructive" className="ml-2">
                  No coincide con el neto
                </Badge>
              )}
            </span>
            <span>
              Estado del reporte:{" "}
              <strong>{STATEMENT_STATUS_LABELS[statement.status] ?? statement.status}</strong>
            </span>
            <span className="w-full text-xs text-muted-foreground">
              Importación —{" "}
              {Object.entries(importStatusCounts)
                .map(([state, count]) => `${IMPORT_STATUS_LABELS[state] ?? state}: ${count}`)
                .join(" · ")}
            </span>
            {Object.keys(reconciliationCounts).length > 0 && (
              <span className="w-full text-xs text-muted-foreground">
                Conciliación —{" "}
                {Object.entries(reconciliationCounts)
                  .map(([state, count]) => `${RECONCILIATION_STATE_LABELS[state] ?? state}: ${count}`)
                  .join(" · ")}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {duplicate === "1" && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Este archivo ya existe. Se abrió la importación anterior para continuar las filas pendientes.
        </p>
      )}

      {integrityError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {integrityError}
        </p>
      )}

      {statement.carrierRecognized === false && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          El carrier detectado (&quot;{statement.detectedCarrierName}&quot;) no existe en el catálogo de carriers
          del CRM — revísalo en Configuración antes de aplicar este reporte. Nunca se crea un carrier
          automáticamente.
        </p>
      )}

      {statement.footerAmbiguous && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Total general no verificable — el total declarado en el pie de este reporte no coincide con la suma de
          las filas mostradas abajo (posible subtotal de página en un reporte multipágina). Revísalo
          manualmente antes de aplicar.
        </p>
      )}

      {/* Fase 025.5.5 (UAT-21): `appliedAt` NUNCA implica que el reporte
          es inmutable — un statement con aplicaciones anteriores sigue
          mostrando el botón de aplicar si quedan filas listas. Solo se
          muestra el aviso histórico (sin el botón) cuando de verdad ya
          no queda nada accionable. */}
      {statement.firstAppliedAt && (
        <p className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
          {isClosed
            ? `Este reporte ya fue aplicado el ${statement.appliedAt ? formatDateOnlyUS(statement.appliedAt) : "—"}.`
            : "Este reporte tiene aplicaciones anteriores. Puedes continuar procesando las filas pendientes."}
        </p>
      )}

      {hideReason ? (
        <span className="text-xs text-destructive">
          {hideReason === "integrity" &&
            "Aplicar está bloqueado hasta resolver el error de integridad de arriba."}
          {hideReason === "carrier" && "Aplicar está bloqueado hasta que el carrier detectado sea reconocido."}
          {hideReason === "footer" && "Aplicar está bloqueado hasta que el total general sea verificable."}
          {hideReason === "closed" &&
            (isDuplicateBlocked
              ? "Aplicar está bloqueado — este reporte fue marcado como posible duplicado."
              : "Este reporte está cerrado — no quedan filas pendientes de aplicar.")}
          {hideReason === "zero_ready" && "No hay filas listas para aplicar todavía."}
        </span>
      ) : (
        <div className="flex items-center gap-3">
          <ApplyStatementButton statementId={statement.id} pendingCount={readyCount} />
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
                <th className="py-2 pr-3">Member ID</th>
                <th className="py-2 pr-3">Carrier / Estado</th>
                <th className="py-2 pr-3">Periodo / Fechas</th>
                <th className="py-2 pr-3">Póliza emparejada</th>
                <th className="py-2 pr-3">Clasif. histórica</th>
                <th className="py-2 pr-3">Esperado</th>
                <th className="py-2 pr-3">Subtotal</th>
                <th className="py-2 pr-3">Asistencia</th>
                <th className="py-2 pr-3">Neto</th>
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
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {row.carrier ?? "—"} {row.state ? `/ ${row.state}` : ""}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <div className="font-medium text-foreground">
                      {row.commissionPeriod ? formatPeriodUS(row.commissionPeriod) : "Sin periodo"}
                    </div>
                    <div className="text-muted-foreground">
                      {row.paidAt && <div>Pagado: {formatDateOnlyUS(row.paidAt)}</div>}
                      {row.effectiveDate && <div>Vigencia: {formatDateOnlyUS(row.effectiveDate)}</div>}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {row.matchedPolicy ? (
                      <Link href={`/policies/${row.matchedPolicy.id}`} className="underline">
                        {row.matchedPolicy.holder.firstName} {row.matchedPolicy.holder.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {row.matchedPolicy ? BUSINESS_MODALITY_LABELS[row.matchedPolicy.businessSource] ?? row.matchedPolicy.businessSource : "—"}
                  </td>
                  <td className="py-2 pr-3">{row.expectedAmount ? `$${row.expectedAmount.toString()}` : "—"}</td>
                  <td className="py-2 pr-3">${row.receivedAmount.toString()}</td>
                  <td className="py-2 pr-3">${row.assistanceAmount.toString()}</td>
                  <td className="py-2 pr-3">${row.netAmount.toString()}</td>
                  <td className="py-2 pr-3">{row.difference ? `$${row.difference}` : "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={IMPORT_STATUS_VARIANT[row.importStatus] ?? "outline"}>
                      {IMPORT_STATUS_LABELS[row.importStatus] ?? row.importStatus}
                    </Badge>
                    {(row.importStatus === "READY" || row.importStatus === "APPLIED") && (
                      <Badge variant={RECONCILIATION_STATE_VARIANT[row.reviewState] ?? "outline"} className="ml-1">
                        {RECONCILIATION_STATE_LABELS[row.reviewState] ?? row.reviewState}
                      </Badge>
                    )}
                    {row.errorCode && (
                      <p className="mt-1 max-w-[220px] text-xs text-destructive">{row.errorCode}</p>
                    )}
                    {row.warnings.length > 0 && (
                      <p className="mt-1 max-w-[220px] text-xs text-amber-600 dark:text-amber-400">
                        {row.warnings.join(" ")}
                      </p>
                    )}
                  </td>
                  <td className="py-2">
                    {row.alreadyApplied ? (
                      <span className="text-xs text-muted-foreground">Aplicado</span>
                    ) : row.matchStatus === "DUPLICATE" ? (
                      <span className="text-xs text-muted-foreground">
                        Ya aplicada en otro reporte — nunca se reaplica
                      </span>
                    ) : row.matchStatus === "UNMATCHED" ||
                      row.matchStatus === "AMBIGUOUS" ||
                      row.matchStatus === "INVALID" ? (
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

      {applyBatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Historial de aplicaciones ({applyBatches.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Aplicado por</th>
                  <th className="py-2 pr-3">Filas aplicadas</th>
                  <th className="py-2 pr-3">Pagos creados</th>
                  <th className="py-2 pr-3">Bruto</th>
                  <th className="py-2 pr-3">Asistencia</th>
                  <th className="py-2">Neto</th>
                </tr>
              </thead>
              <tbody>
                {applyBatches.map((batch) => (
                  <tr key={batch.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{formatDateOnlyUS(batch.appliedAt)}</td>
                    <td className="py-2 pr-3">{batch.appliedBy?.name ?? "—"}</td>
                    <td className="py-2 pr-3">{batch.rowsApplied}</td>
                    <td className="py-2 pr-3">{batch.paymentsCreated}</td>
                    <td className="py-2 pr-3">${batch.grossAmount.toString()}</td>
                    <td className="py-2 pr-3">${batch.assistanceAmount.toString()}</td>
                    <td className="py-2">${batch.netAmount.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
