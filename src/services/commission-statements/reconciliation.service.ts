import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { recordAuditEvent } from "@/services/audit.service";
import { looksLikeZipArchive, sniffMimeType } from "@/lib/file-sniff";
import {
  commissionStatementIdSchema,
  commissionStatementRowIdSchema,
  manualMatchRowSchema,
  uploadCommissionStatementSchema,
  MAX_STATEMENT_SIZE_BYTES,
} from "@/schemas/commission-statement.schema";
import { getStatementAdapter } from "./registry";
import {
  matchStatementRow,
  findExpectationForPolicy,
  inferPeriod,
  checkModalityCompatibility,
  type MatchResult,
} from "./matcher";
import { computePeriodMatch } from "./policy-candidates";
import { normalizeCarrierForComparison, MultipleCarriersError } from "./carrier-detection";
import { PdfParseError, PdfTooManyPagesError, PdfTooManyRowsError, PdfFormatMismatchError } from "./pdf-table-extract";
import type { NormalizedCommissionRow } from "./types";
import { Prisma, type CommissionStatementStatus } from "@/generated/prisma/client";
import { formatPeriodUS } from "@/lib/business-time";

// ---------------------------------------------------------------------------
// Orquestador de conciliación de comisiones — Fase 020 (§17: Preview
// antes de Apply, nunca automático). Flujo:
//
//   Upload/parse -> Preview -> Matching -> Review -> Confirm -> Apply
//
// Nunca crea CommissionPayment al subir un archivo — eso solo ocurre
// en applyStatement(), una acción ADMIN explícita separada.
// ---------------------------------------------------------------------------

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede realizar esta acción.");
  }
}

function assertModuleAccess(actor: AuthorizedUser): void {
  if (actor.role === "ASSISTANT") {
    throw new AppError("FORBIDDEN", "No tienes acceso al módulo de comisiones.");
  }
}

function sanitizeFileName(raw: string): string {
  const stripped = raw.replace(/[/\\]/g, "").replace(/[^\w.\- ]/g, "");
  return stripped.slice(0, 200) || "reporte";
}

// Fingerprint = hash del CONTENIDO normalizado, nunca del nombre de
// archivo — subir el mismo reporte con otro nombre se detecta igual
// (§20 de la ficha).
function computeFingerprint(source: string, rows: NormalizedCommissionRow[]): string {
  const canonical = rows
    .map((r) => ({
      id: r.externalMemberId ?? r.memberName ?? "",
      amount: r.receivedAmount,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      effectiveDate: r.effectiveDate ? r.effectiveDate.toISOString() : null,
    }))
    .sort((a, b) => (a.id + a.amount).localeCompare(b.id + b.amount));
  const hash = createHash("sha256");
  hash.update(source);
  hash.update(JSON.stringify(canonical));
  return hash.digest("hex");
}

// Fingerprint POR FILA (distinto del fingerprint del archivo completo
// de arriba) — detecta que ESTA fila puntual ya fue aplicada antes en
// otra importación, aunque el archivo completo sea distinto (ej. un
// reporte corregido/reenviado que repite algunas filas ya pagadas).
// Nunca usa PII cruda: el identificador se normaliza y se hashea junto
// con el resto de la clave, nunca se persiste en claro.
function computeRowFingerprint(source: string, row: NormalizedCommissionRow): string {
  const period = inferPeriod(row);
  const id = (row.externalMemberId ?? row.memberName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const hash = createHash("sha256");
  hash.update(source);
  hash.update(id);
  hash.update(period ? period.toISOString() : "");
  hash.update(row.receivedAmount);
  return hash.digest("hex");
}

const statementSelect = {
  id: true,
  source: true,
  fileName: true,
  fingerprint: true,
  statementPeriod: true,
  uploadedAt: true,
  status: true,
  totalRows: true,
  matchedRows: true,
  unmatchedRows: true,
  ambiguousRows: true,
  appliedRows: true,
  receivedTotal: true,
  appliedAt: true,
  firstAppliedAt: true,
  payerAgency: true,
  businessModality: true,
  assistanceTotal: true,
  netTotal: true,
  declaredFooterTotal: true,
  footerMatchesNet: true,
  footerAmbiguous: true,
  detectedCarrierName: true,
  carrierRecognized: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.CommissionStatementSelect;

const rowSelect = {
  id: true,
  rowNumber: true,
  externalId: true,
  displayName: true,
  receivedAmount: true,
  assistanceAmount: true,
  netAmount: true,
  effectiveDate: true,
  paidAt: true,
  matchStatus: true,
  matchedPolicyId: true,
  matchedExpectationId: true,
  matchedPolicyMemberId: true,
  errorCode: true,
  metadata: true,
  matchedPolicy: {
    select: {
      id: true,
      policyNumber: true,
      businessSource: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      holder: { select: { id: true, firstName: true, lastName: true } },
      product: { select: { name: true, planYear: true, carrier: { select: { name: true } } } },
    },
  },
  matchedPolicyMember: {
    select: { id: true, role: true, person: { select: { firstName: true, lastName: true } } },
  },
  matchedExpectation: { select: { id: true, expectedAmount: true, period: true } },
  payment: { select: { id: true } },
} satisfies Prisma.CommissionStatementRowSelect;

// ---------------------------------------------------------------------------
// Upload + parse + matching automático — nunca crea CommissionPayment.
// ---------------------------------------------------------------------------
export async function uploadCommissionStatement(
  actor: AuthorizedUser,
  rawSource: unknown,
  file: File
): Promise<{ duplicate: true; existingStatementId: string } | { duplicate: false; statementId: string }> {
  assertModuleAccess(actor);
  assertAdminOnly(actor);

  const { source } = parseOrThrow(uploadCommissionStatementSchema, { source: rawSource });

  const adapter = getStatementAdapter(source);
  if (!adapter) throw new AppError("VALIDATION_ERROR", "source: Fuente de reporte no soportada.");

  if (file.size === 0) throw new AppError("VALIDATION_ERROR", "file: Selecciona un archivo.");
  if (file.size > MAX_STATEMENT_SIZE_BYTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      `file: El archivo supera el tamaño máximo permitido (${MAX_STATEMENT_SIZE_BYTES / (1024 * 1024)} MB).`
    );
  }

  const fileName = sanitizeFileName(file.name || "reporte");
  const lowerName = fileName.toLowerCase();
  if (!adapter.acceptedExtensions.some((ext) => lowerName.endsWith(ext))) {
    throw new AppError(
      "VALIDATION_ERROR",
      `file: ${adapter.label} solo acepta archivos ${adapter.acceptedExtensions.join("/")}.`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Verificación mínima de contenido real (nunca solo la extensión) —
  // XLSX es un ZIP, se valida la firma antes de intentar parsearlo.
  // CSV es texto plano sin firma binaria posible; su validación real
  // es que el adapter exija las columnas esperadas (ver
  // orange-oscar-adapter.ts), que ya rechaza contenido no conforme.
  if (lowerName.endsWith(".xlsx") && !looksLikeZipArchive(buffer)) {
    throw new AppError("VALIDATION_ERROR", "file: El archivo no es un XLSX válido.");
  }
  // Fase 025.4 (UAT-05): PDF real por firma %PDF-, nunca solo la
  // extensión .pdf — mismo rigor que el resto de uploads del CRM
  // (ver sniffMimeType, ya usado por PolicyDocument).
  if (lowerName.endsWith(".pdf") && sniffMimeType(buffer) !== "application/pdf") {
    throw new AppError("VALIDATION_ERROR", "file: El archivo no es un PDF válido.");
  }

  let parsed;
  try {
    parsed = await adapter.parse(buffer, fileName);
  } catch (error) {
    // Fase 025.5.4 — separar "el PDF tiene un problema real" (dañado,
    // cifrado, formato/columnas no compatibles, más de un carrier,
    // demasiadas páginas/filas) de "falló el procesador" (worker de
    // pdfjs, módulo faltante, error interno inesperado). Nunca se le
    // dice al ADMIN que su archivo está dañado cuando en realidad es un
    // problema de configuración/infraestructura — eso fue exactamente
    // el bug reportado (worker de pdfjs mostrado como "PDF inválido").
    const isKnownFileIssue =
      error instanceof PdfParseError ||
      error instanceof PdfTooManyPagesError ||
      error instanceof PdfTooManyRowsError ||
      error instanceof PdfFormatMismatchError ||
      error instanceof MultipleCarriersError;

    if (isKnownFileIssue) {
      throw new AppError("VALIDATION_ERROR", `file: ${(error as Error).message}`);
    }

    // Error interno del procesador — mensaje genérico y seguro para el
    // ADMIN (nunca rutas locales, nombres de chunk ni stack traces); el
    // detalle técnico real se registra SOLO en el servidor, sin PII ni
    // contenido del PDF (nunca el buffer, nunca el nombre de archivo
    // crudo del usuario).
    console.error(
      "[commission-statements] Fallo interno al procesar un PDF de comisiones:",
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
    throw new AppError(
      "VALIDATION_ERROR",
      "file: No pudimos procesar el PDF por un error interno. El archivo no fue aplicado. Intenta nuevamente o contacta al administrador."
    );
  }

  if (parsed.rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", "file: El archivo no contiene filas reconocibles.");
  }

  // Fase 025.5.3: el carrier se DETECTA del contenido (nunca se
  // selecciona en la UI) y se busca en el catálogo existente por nombre
  // normalizado — NUNCA se crea un Carrier automáticamente. Un carrier
  // no reconocido no bloquea la subida (el ADMIN debe poder ver qué se
  // detectó en el preview), pero sí bloquea el apply (ver
  // applyCommissionStatement, más abajo).
  let carrierRecognized: boolean | null = null;
  if (parsed.detectedCarrierRaw) {
    const normalizedDetected = normalizeCarrierForComparison(parsed.detectedCarrierRaw);
    const existingCarriers = await prisma.carrier.findMany({ select: { name: true } });
    carrierRecognized = existingCarriers.some((c) => normalizeCarrierForComparison(c.name) === normalizedDetected);
  }

  const fingerprint = computeFingerprint(source, parsed.rows);
  const existing = await prisma.commissionStatement.findUnique({
    where: { fingerprint },
    select: { id: true },
  });
  if (existing) {
    return { duplicate: true, existingStatementId: existing.id };
  }

  // Fase 025.5: fingerprint por fila ANTES de emparejar — una fila cuyo
  // fingerprint ya fue aplicado en un statement previo (ej. un reporte
  // corregido/reenviado que repite filas ya pagadas) nunca se vuelve a
  // emparejar/aplicar, sin importar cuántas veces se re-suba.
  const rowFingerprints = parsed.rows.map((row) => computeRowFingerprint(source, row));
  const alreadyAppliedFingerprints = new Set(
    (
      await prisma.commissionStatementRow.findMany({
        where: { rowFingerprint: { in: rowFingerprints }, matchStatus: "APPLIED" },
        select: { rowFingerprint: true },
      })
    ).map((r) => r.rowFingerprint)
  );

  // Matching: lecturas fuera de la transacción (solo SELECTs, sin
  // riesgo de estado a medias); la escritura real (statement + filas +
  // audit event) sí es una sola transacción atómica.
  const matchOptions = { businessModality: parsed.businessModality, policyType: parsed.policyType };
  const matches: MatchResult[] = await Promise.all(
    // Promise.all aquí es seguro: son llamadas independientes que usan
    // el pool normal de conexiones de Prisma, no una transacción
    // interactiva fijada a una sola conexión (ver el hallazgo de
    // concurrencia de pg, Fase 019.6 — ese problema es específico de
    // $transaction(async tx => ...) / $transaction([...]), no de
    // queries top-level).
    parsed.rows.map((row, i) =>
      alreadyAppliedFingerprints.has(rowFingerprints[i])
        ? Promise.resolve<MatchResult>({ status: "UNMATCHED" })
        : matchStatementRow(source, row, matchOptions)
    )
  );

  let matchedCount = 0;
  let unmatchedCount = 0;
  let ambiguousCount = 0;
  let duplicateCount = 0;
  let assistanceTotalSum = new Prisma.Decimal(0);
  let netTotalSum = new Prisma.Decimal(0);
  const receivedTotal = parsed.rows
    .reduce((sum, r) => sum.plus(new Prisma.Decimal(r.receivedAmount)), new Prisma.Decimal(0))
    .toFixed(2);

  const rowsData = parsed.rows.map((row, i) => {
    const isDuplicate = alreadyAppliedFingerprints.has(rowFingerprints[i]);
    const match = matches[i];
    const matchStatus: MatchResult["status"] | "DUPLICATE" = isDuplicate ? "DUPLICATE" : match.status;

    if (matchStatus === "MATCHED") matchedCount++;
    else if (matchStatus === "AMBIGUOUS") ambiguousCount++;
    else unmatchedCount++; // UNMATCHED, INVALID o DUPLICATE: nunca se auto-aplican, requieren revisión.
    if (matchStatus === "DUPLICATE") duplicateCount++;

    assistanceTotalSum = assistanceTotalSum.plus(new Prisma.Decimal(row.assistanceAmount ?? "0"));
    netTotalSum = netTotalSum.plus(new Prisma.Decimal(row.netAmount ?? row.receivedAmount));

    return {
      id: randomUUID(),
      statementId: "", // se completa abajo tras crear el statement
      rowNumber: row.sourceRowNumber,
      externalId: row.externalMemberId ?? null,
      displayName: row.memberName ?? null,
      receivedAmount: row.receivedAmount,
      assistanceAmount: row.assistanceAmount ?? "0",
      netAmount: row.netAmount ?? row.receivedAmount,
      effectiveDate: row.effectiveDate ?? null,
      paidAt: row.paidAt ?? null,
      matchStatus,
      matchedPolicyId: !isDuplicate && (match.status === "MATCHED" || match.status === "INVALID") ? match.policyId : null,
      matchedExpectationId:
        !isDuplicate && (match.status === "MATCHED" || match.status === "INVALID") ? match.expectationId : null,
      errorCode: isDuplicate
        ? "Fila duplicada: ya fue aplicada anteriormente en otro reporte."
        : match.status === "INVALID"
          ? match.reason
          : null,
      rowFingerprint: rowFingerprints[i],
      // Solo campos operativos seguros — nunca la fila cruda completa
      // (ver docs/SECURITY.md).
      metadata: {
        agentName: row.agentName ?? null,
        saleType: row.saleType ?? null,
        state: row.state ?? null,
        carrier: row.carrier ?? null,
        status: row.status ?? null,
        rate: row.rate ?? null,
        memberCount: row.memberCount ?? null,
        ...(match.status === "AMBIGUOUS" ? { candidatePolicyIds: match.candidatePolicyIds } : {}),
        ...(row.warnings && row.warnings.length > 0 ? { warnings: row.warnings } : {}),
      } as Prisma.InputJsonValue,
    };
  });

  // El pie del PDF típicamente reporta el NETO (Subtotal - Asistencia),
  // nunca el bruto — se compara contra la suma de netAmount calculada
  // fila por fila, nunca se asume que coincide sin comparar.
  const declaredFooterTotal = parsed.declaredTotal ? new Prisma.Decimal(parsed.declaredTotal) : null;
  const footerMatchesNet = declaredFooterTotal
    ? declaredFooterTotal.minus(netTotalSum).abs().lessThanOrEqualTo("0.01")
    : null;
  // Fase 1.1 (UAT real "OSCAR MARZO (1)"): además del combinado, se
  // valida CADA bloque/tabla independiente contra su propio footer —
  // un archivo con 2 bloques donde uno está de más y el otro de menos
  // podría "cuadrar" en el combinado y ocultar un error real. Nunca se
  // confía solo en el total general cuando el archivo trae bloques.
  const blocksMismatch = (parsed.footerBlocks ?? []).some(
    (b) => new Prisma.Decimal(b.declaredTotal).minus(b.actualNetSum).abs().greaterThan("0.01")
  );
  // Fase 025.5.5 (TOTAL GENERAL EN REPORTES MULTIPÁGINA): un total
  // declarado que NO reconcilia con la suma de netAmount de las filas
  // EFECTIVAMENTE mostradas en el preview no puede confiarse como total
  // general (típico de un reporte multipágina donde el footer detectado
  // resultó ser un subtotal de página, no el acumulado completo) —
  // nunca se aplica un reporte en ese estado, aunque el preview siga
  // disponible para revisión manual. Lo mismo aplica si algún bloque
  // individual no reconcilia, aunque el combinado sí lo haga.
  const footerAmbiguous = footerMatchesNet === false || blocksMismatch;

  const statementId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.commissionStatement.create({
      data: {
        id: statementId,
        source,
        fileName,
        fingerprint,
        uploadedById: actor.id,
        // Fase 025.5.5 (UAT-21): calculado igual que recomputeStatementCounts
        // — al subir, appliedRows siempre es 0, así que solo puede salir
        // PENDING_REVIEW (quedan filas accionables) o, en el caso límite de
        // un archivo modificado donde TODAS las filas ya fueron aplicadas
        // antes en otro reporte, CLOSED_WITH_SKIPPED_ROWS de inmediato.
        status: computeStatementStatus({
          totalRows: parsed.rows.length,
          appliedRows: 0,
          actionableRows: parsed.rows.length - duplicateCount,
        }),
        totalRows: parsed.rows.length,
        matchedRows: matchedCount,
        unmatchedRows: unmatchedCount,
        ambiguousRows: ambiguousCount,
        appliedRows: 0,
        receivedTotal,
        payerAgency: parsed.payerAgency ?? null,
        businessModality: parsed.businessModality ?? null,
        assistanceTotal: assistanceTotalSum.toFixed(2),
        netTotal: netTotalSum.toFixed(2),
        declaredFooterTotal: declaredFooterTotal ? declaredFooterTotal.toFixed(2) : null,
        footerMatchesNet,
        footerAmbiguous,
        adapterVersion: parsed.adapterVersion ?? "1",
        detectedCarrierName: parsed.detectedCarrierRaw ?? null,
        carrierRecognized,
      },
    });
    for (const rowData of rowsData) {
      await tx.commissionStatementRow.create({
        data: { ...rowData, statementId },
      });
    }
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionStatement",
      entityId: statementId,
      action: "COMMISSION_STATEMENT_UPLOAD",
      summary: `Reporte de comisiones subido (${parsed.rows.length} filas)`,
      metadata: { source, fileName, totalRows: parsed.rows.length },
    });
  });

  return { duplicate: false, statementId };
}

// Todo el módulo de conciliación (ver/subir/matching/apply) es
// ADMIN-only — más estricto que el resto de Comisiones, donde AGENT sí
// tiene lectura (ver docs/SECURITY.md). Un statement no está acotado
// por agente (puede traer filas de pólizas de varios agentes a la
// vez), así que no hay un scoping parcial razonable: AGENT sigue
// viendo los CommissionPayment resultantes a través del módulo normal
// de Comisiones (ya scoped), una vez que el ADMIN aplica el statement.
export async function getCommissionStatement(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionStatementIdSchema, rawId);
  const statement = await prisma.commissionStatement.findUnique({ where: { id }, select: statementSelect });
  if (!statement) throw new AppError("NOT_FOUND", "Reporte no encontrado.");
  return statement;
}

// Fase 025.5.5 (UAT-19): resume los meses de comisión cubiertos por un
// reporte para el historial — nunca la fecha de subida. Un mismo
// archivo puede tener varias filas con Policy/miembro/carrier iguales
// pero meses distintos (no son duplicadas, ver rowFingerprint), así
// que el historial debe reflejar el RANGO real, no un solo mes
// arbitrario.
type PeriodSummary = { min: Date; max: Date; distinctMonths: number } | null;

function summarizePeriods(periods: Date[]): PeriodSummary {
  if (periods.length === 0) return null;
  const times = Array.from(new Set(periods.map((p) => p.getTime()))).sort((a, b) => a - b);
  return { min: new Date(times[0]), max: new Date(times[times.length - 1]), distinctMonths: times.length };
}

export async function listCommissionStatements(actor: AuthorizedUser) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const statements = await prisma.commissionStatement.findMany({
    select: statementSelect,
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  const rows = await prisma.commissionStatementRow.findMany({
    where: { statementId: { in: statements.map((s) => s.id) } },
    select: { statementId: true, paidAt: true, effectiveDate: true },
  });
  const periodsByStatement = new Map<string, Date[]>();
  for (const row of rows) {
    const period = inferPeriod({
      source: "",
      receivedAmount: "0",
      sourceRowNumber: 0,
      paidAt: row.paidAt,
      effectiveDate: row.effectiveDate,
    } as NormalizedCommissionRow);
    if (!period) continue;
    const list = periodsByStatement.get(row.statementId) ?? [];
    list.push(period);
    periodsByStatement.set(row.statementId, list);
  }

  return statements.map((s) => ({
    ...s,
    periodSummary: summarizePeriods(periodsByStatement.get(s.id) ?? []),
  }));
}

// Preview con expected/received/difference calculado en el momento —
// nunca almacenado (§18 de la ficha).
// Fase 025.5.1 (PENDIENTE 025.5-B): el preview nunca expone un
// identificador externo (Member ID) completo — solo confirma que EXISTE
// y sus últimos 4 caracteres, suficiente para que el ADMIN reconozca
// "es este" sin poder leerlo/copiarlo completo desde la pantalla.
function maskExternalId(id: string | null): string | null {
  if (!id) return null;
  if (id.length <= 4) return "*".repeat(id.length);
  return `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
}

export async function getCommissionStatementPreview(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionStatementIdSchema, rawId);
  const statement = await prisma.commissionStatement.findUnique({ where: { id }, select: statementSelect });
  if (!statement) throw new AppError("NOT_FOUND", "Reporte no encontrado.");

  const rows = await prisma.commissionStatementRow.findMany({
    where: { statementId: id },
    select: rowSelect,
    orderBy: { rowNumber: "asc" },
  });

  // Fase 025.5.5 (UAT-21): historial de cada aplicación parcial — nunca
  // PII (solo agregados y quién/cuándo aplicó), más reciente primero.
  const applyBatches = await prisma.commissionStatementApplyBatch.findMany({
    where: { statementId: id },
    select: {
      id: true,
      appliedAt: true,
      rowsApplied: true,
      paymentsCreated: true,
      grossAmount: true,
      assistanceAmount: true,
      netAmount: true,
      appliedBy: { select: { id: true, name: true } },
    },
    orderBy: { appliedAt: "desc" },
  });

  const enriched = rows.map((row) => {
    const hasExpectation = !!row.matchedExpectation;
    const received = new Prisma.Decimal(row.receivedAmount);
    // Fase 025.5.5 (UAT-16): mientras no exista CommissionExpectation,
    // "Esperado" se muestra como $0 explícito (nunca un guion ambiguo)
    // y la diferencia es PROVISIONAL (recibido - 0) — nunca se declara
    // "conciliado" sin una expectativa real detrás. En cuanto se cree
    // la expectativa (ver commission-payment-linking.ts), este mismo
    // cálculo la recoge automáticamente sin volver a subir el archivo.
    const expected = hasExpectation ? new Prisma.Decimal(row.matchedExpectation!.expectedAmount) : new Prisma.Decimal(0);
    const difference = received.minus(expected);
    const reviewState =
      row.matchStatus === "UNMATCHED"
        ? "UNMATCHED"
        : row.matchStatus === "AMBIGUOUS"
          ? "AMBIGUOUS"
          : row.matchStatus === "IGNORED"
            ? "IGNORED"
            : row.matchStatus === "INVALID"
              ? "INVALID"
              : row.matchStatus === "DUPLICATE"
                ? "DUPLICATE"
                : !hasExpectation
                  ? "NO_EXPECTATION"
                  : difference.isZero()
                    ? "MATCH"
                    : difference.isPositive()
                      ? "OVERPAID"
                      : "UNDERPAID";

    // Solo campos operativos seguros ya guardados en metadata (nunca la
    // fila cruda) — ver el comentario de metadata en uploadCommissionStatement.
    const metadata = (row.metadata ?? {}) as {
      state?: string | null;
      carrier?: string | null;
      rate?: string | null;
      memberCount?: number | null;
      warnings?: string[];
    };

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      externalId: maskExternalId(row.externalId),
      displayName: row.displayName,
      state: metadata.state ?? null,
      carrier: metadata.carrier ?? null,
      rate: metadata.rate ?? null,
      memberCount: metadata.memberCount ?? null,
      warnings: metadata.warnings ?? [],
      effectiveDate: row.effectiveDate,
      paidAt: row.paidAt,
      // Fase 025.5.5 (UAT-19): período de comisión normalizado (primer
      // día del mes, ancla UTC) — mismo cálculo que matching/apply
      // (inferPeriod: paidAt preferido, effectiveDate como respaldo).
      // Nunca es la fecha de subida; se muestra SEPARADO de Effective
      // Date, que es la vigencia de la póliza, no el mes de comisión.
      commissionPeriod: inferPeriod({
        source: "",
        receivedAmount: "0",
        sourceRowNumber: 0,
        paidAt: row.paidAt,
        effectiveDate: row.effectiveDate,
      } as NormalizedCommissionRow),
      receivedAmount: row.receivedAmount,
      assistanceAmount: row.assistanceAmount,
      netAmount: row.netAmount,
      expectedAmount: expected.toFixed(2),
      difference: difference.toFixed(2),
      hasExpectation,
      matchStatus: row.matchStatus,
      // Fase 025.5.5 (UAT-21): "Estado de importación" — SIEMPRE
      // independiente de si existe expectativa. Una fila MATCHED sin
      // expectativa sigue siendo "READY" (lista para aplicar); el
      // reviewState de abajo describe la conciliación por separado,
      // nunca sustituye a este estado operativo.
      importStatus: row.matchStatus === "MATCHED" ? "READY" : row.matchStatus,
      reviewState,
      errorCode: row.errorCode,
      matchedPolicy: row.matchedPolicy,
      matchedPolicyMember: row.matchedPolicyMember,
      alreadyApplied: !!row.payment,
      // Fase 025.5.6 (UAT-22) — diagnóstico de mappings YA confirmados,
      // solo lectura: nunca corrige nada automáticamente, solo señala
      // qué filas convendría que el ADMIN revise manualmente (nunca
      // filas sin póliza emparejada — ahí no hay nada que diagnosticar
      // todavía).
      mappingDiagnostic: row.matchedPolicy
        ? {
            periodMismatch:
              computePeriodMatch(
                inferPeriod({
                  source: "",
                  receivedAmount: "0",
                  sourceRowNumber: 0,
                  paidAt: row.paidAt,
                  effectiveDate: row.effectiveDate,
                } as NormalizedCommissionRow),
                row.matchedPolicy.effectiveDate,
                row.matchedPolicy.terminationDate
              ) !== "MATCH",
            modalityMismatch:
              !!statement.businessModality && row.matchedPolicy.businessSource !== statement.businessModality,
            carrierMismatch:
              !!statement.detectedCarrierName &&
              row.matchedPolicy.product.carrier.name.trim().toLowerCase() !==
                statement.detectedCarrierName.trim().toLowerCase(),
            missingRequiredMember:
              statement.payerAgency === "ORANGE" &&
              statement.businessModality === "REFERRAL" &&
              !row.matchedPolicyMemberId,
          }
        : null,
    };
  });

  const mappingDiagnosticSummary = {
    periodMismatch: enriched.filter((r) => r.mappingDiagnostic?.periodMismatch).length,
    modalityMismatch: enriched.filter((r) => r.mappingDiagnostic?.modalityMismatch).length,
    carrierMismatch: enriched.filter((r) => r.mappingDiagnostic?.carrierMismatch).length,
    missingRequiredMember: enriched.filter((r) => r.mappingDiagnostic?.missingRequiredMember).length,
  };

  // Fase 025.5.2 (Corrección 3) — invariante de integridad: la misma
  // colección de filas normalizadas alimenta la tabla del preview, los
  // conteos y los totales (nunca colecciones distintas para cada cosa),
  // así que por construcción cada fila aporta a exactamente un estado y
  // `detectedRows` (lo que se guardó al subir) debe coincidir con la
  // cantidad de filas realmente recuperada aquí. Si alguna vez
  // divergieran (ej. una fila se borró fuera del flujo normal), se
  // reporta como error de integridad explícito — nunca se declara el
  // reporte como "validado correctamente" en ese caso.
  const integrityError =
    statement.totalRows !== rows.length
      ? `Inconsistencia de integridad: el reporte registra ${statement.totalRows} fila(s) pero se encontraron ${rows.length} — revisión manual requerida antes de aplicar.`
      : null;

  return { statement, rows: enriched, integrityError, applyBatches, mappingDiagnosticSummary };
}

// Candidatos elegibles para un match manual (filas UNMATCHED/AMBIGUOUS)
// — búsqueda simple por nombre, misma UX que el resto de la app
// (nunca una lista global sin filtro).
// Fase 025.5.6 (UAT-22): reemplazada por searchPolicyCandidatesForRow en
// ./policy-candidates.ts — servicio ÚNICO de búsqueda de candidatas
// (contexto del período/modalidad de la fila, enriquecido con
// año/vigencia/estado/PolicyMembers), nunca dos implementaciones
// separadas de la misma búsqueda.

export async function manualMatchStatementRow(actor: AuthorizedUser, rawRowId: unknown, rawInput: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const rowId = parseOrThrow(commissionStatementRowIdSchema, rawRowId);
  const input = parseOrThrow(manualMatchRowSchema, rawInput);

  const row = await prisma.commissionStatementRow.findUnique({
    where: { id: rowId },
    select: { id: true, statementId: true, matchStatus: true, externalId: true, effectiveDate: true, paidAt: true },
  });
  if (!row) throw new AppError("NOT_FOUND", "Fila no encontrada.");
  if (row.matchStatus === "APPLIED") {
    throw new AppError("VALIDATION_ERROR", "Esta fila ya fue aplicada, no se puede re-emparejar.");
  }
  if (row.matchStatus === "DUPLICATE") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Esta fila ya fue aplicada anteriormente en otro reporte (duplicada); no se puede re-emparejar."
    );
  }

  const statement = await prisma.commissionStatement.findUniqueOrThrow({
    where: { id: row.statementId },
    select: { source: true, payerAgency: true, businessModality: true, detectedCarrierName: true },
  });

  // Fase 025.5.6 (UAT-22): la ventana de emparejamiento nunca confía
  // ciegamente en lo que envía el navegador — se revalida TODO lo que
  // ya valida el matching automático (nunca una versión más permisiva),
  // más las validaciones nuevas de periodo y miembro.
  const policy = await prisma.policy.findUnique({
    where: { id: input.policyId },
    select: {
      id: true,
      businessSource: true,
      effectiveDate: true,
      terminationDate: true,
      product: { select: { policyType: true } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");

  if (statement.payerAgency !== null && policy.product.policyType !== "HEALTH") {
    throw new AppError("VALIDATION_ERROR", "Esta póliza no es de tipo HEALTH — este reporte solo concilia pagos HEALTH.");
  }

  // Fase 025.5.6 (UAT-22): solo se exige modalidad/clasificación
  // definida cuando el reporte en sí la impone (los 3 adapters PDF
  // reales) — los adaptadores CSV/XLSX de Fase 020 nunca declararon
  // businessModality y nunca exigieron esta validación; exigirla
  // retroactivamente ahí sería una regla nueva fuera del alcance de
  // esta fase. checkModalityCompatibility ya cubre UNKNOWN con un
  // mensaje correcto (nunca lo describe como "referida").
  if (statement.businessModality) {
    const modalityReason = await checkModalityCompatibility(input.policyId, statement.businessModality);
    if (modalityReason) throw new AppError("VALIDATION_ERROR", modalityReason);
  }

  const normalizedRow: NormalizedCommissionRow = {
    source: "", // no se usa dentro de findExpectationForPolicy
    receivedAmount: "0",
    sourceRowNumber: 0,
    effectiveDate: row.effectiveDate,
    paidAt: row.paidAt,
  };
  const period = inferPeriod(normalizedRow);

  // Fase 025.5.6 (UAT-22): una póliza que no cubre el periodo de
  // comisión NUNCA se acepta en silencio — el ADMIN debe confirmar
  // explícitamente con un motivo breve, que queda auditado (nunca se
  // cambian fechas/año de la póliza; la fila queda READY de inmediato,
  // igual que cualquier match manual — no existe en esta arquitectura
  // una cola de "segunda revisión" separada, así que crear una sería
  // sobre-construir; la auditoría explícita es la salvaguarda).
  const periodMatch = computePeriodMatch(period, policy.effectiveDate, policy.terminationDate);
  if (periodMatch !== "MATCH" && !input.outOfPeriodReason) {
    throw new AppError(
      "VALIDATION_ERROR",
      periodMatch === "OUT_OF_PERIOD"
        ? `La póliza seleccionada no cubre el periodo de comisión ${period ? formatPeriodUS(period) : "detectado"}. Escribe un motivo para continuar.`
        : "La vigencia de esta póliza está incompleta — escribe un motivo para continuar."
    );
  }

  // Fase 025.5.6 (UAT-22): Orange Referidas paga por MIEMBRO cubierto,
  // nunca por póliza agregada — exige un PolicyMember válido,
  // perteneciente a esta Policy, y bloquea si otra fila del mismo
  // periodo ya está vinculada al mismo miembro (posible duplicado
  // silencioso, nunca se permite sin revisión).
  const isOrangeReferral = statement.payerAgency === "ORANGE" && statement.businessModality === "REFERRAL";
  if (isOrangeReferral) {
    if (!input.policyMemberId) {
      throw new AppError("VALIDATION_ERROR", "Selecciona el miembro cubierto por esta póliza (Orange Referidas paga por miembro).");
    }
    const member = await prisma.policyMember.findUnique({
      where: { id: input.policyMemberId },
      select: { policyId: true },
    });
    if (!member || member.policyId !== input.policyId) {
      throw new AppError("VALIDATION_ERROR", "El miembro seleccionado no pertenece a esta póliza.");
    }
    if (period) {
      const otherLinkedRows = await prisma.commissionStatementRow.findMany({
        where: {
          id: { not: rowId },
          matchedPolicyMemberId: input.policyMemberId,
          matchStatus: { in: ["MATCHED", "APPLIED"] },
        },
        select: { paidAt: true, effectiveDate: true },
      });
      const isSamePeriod = otherLinkedRows.some((r) => {
        const otherPeriod = inferPeriod({
          source: "",
          receivedAmount: "0",
          sourceRowNumber: 0,
          paidAt: r.paidAt,
          effectiveDate: r.effectiveDate,
        } as NormalizedCommissionRow);
        return otherPeriod && otherPeriod.getTime() === period.getTime();
      });
      if (isSamePeriod) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Otra fila de este mismo periodo ya está vinculada a este miembro — posible duplicado, requiere revisión manual antes de continuar."
        );
      }
    }
  } else if (input.policyMemberId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Esta modalidad no vincula por miembro individual — la conciliación es a nivel póliza."
    );
  }

  const expectationId = await findExpectationForPolicy(input.policyId, normalizedRow);

  await prisma.$transaction(async (tx) => {
    await tx.commissionStatementRow.update({
      where: { id: rowId },
      data: {
        matchStatus: "MATCHED",
        matchedPolicyId: input.policyId,
        matchedExpectationId: expectationId,
        matchedPolicyMemberId: input.policyMemberId ?? null,
      },
    });

    // §16: una vez confirmado un external ID, se guarda la referencia
    // para que próximos statements lo reconozcan automáticamente —
    // solo si no está ya vinculado a OTRA póliza (conflicto real, se
    // reporta en vez de sobrescribir silenciosamente).
    if (row.externalId) {
      const existingRef = await tx.policyExternalReference.findUnique({
        where: {
          source_type_externalId: { source: statement.source, type: "MEMBER_ID", externalId: row.externalId },
        },
        select: { policyId: true },
      });
      if (!existingRef) {
        await tx.policyExternalReference.create({
          data: { policyId: input.policyId, source: statement.source, type: "MEMBER_ID", externalId: row.externalId },
        });
      } else if (existingRef.policyId !== input.policyId) {
        throw new AppError(
          "CONFLICT",
          "Este identificador externo ya está vinculado a otra póliza distinta."
        );
      }
    }

    await recomputeStatementCounts(tx, row.statementId);
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionStatementRow",
      entityId: rowId,
      action: "COMMISSION_STATEMENT_MATCH",
      policyId: input.policyId,
      summary:
        periodMatch === "MATCH"
          ? "Fila de reporte emparejada manualmente con una póliza"
          : `Fila de reporte emparejada manualmente con una póliza FUERA de periodo (${periodMatch}) — motivo administrativo registrado`,
      // Nunca PII: solo el tipo de discrepancia y el motivo administrativo
      // que el propio ADMIN escribió (nunca datos del reporte/cliente).
      metadata: {
        periodMatch,
        ...(input.outOfPeriodReason ? { outOfPeriodReason: input.outOfPeriodReason } : {}),
        ...(input.policyMemberId ? { matchedPolicyMemberId: input.policyMemberId } : {}),
      },
    });
  });

  return getCommissionStatementPreview(actor, row.statementId);
}

export async function ignoreStatementRow(actor: AuthorizedUser, rawRowId: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const rowId = parseOrThrow(commissionStatementRowIdSchema, rawRowId);
  const row = await prisma.commissionStatementRow.findUnique({
    where: { id: rowId },
    select: { id: true, statementId: true, matchStatus: true },
  });
  if (!row) throw new AppError("NOT_FOUND", "Fila no encontrada.");
  if (row.matchStatus === "APPLIED") {
    throw new AppError("VALIDATION_ERROR", "Esta fila ya fue aplicada, no se puede ignorar.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.commissionStatementRow.update({ where: { id: rowId }, data: { matchStatus: "IGNORED" } });
    await recomputeStatementCounts(tx, row.statementId);
  });
  return getCommissionStatementPreview(actor, row.statementId);
}

// Secuencial, nunca Promise.all: dentro de una transacción interactiva
// ($transaction(async tx => ...)), todas las consultas comparten UNA
// sola conexión pinneada — lanzarlas en paralelo dispara la advertencia
// real de pg "Calling client.query() when the client is already
// executing a query" (ver docs/DECISIONS.md, Fase 020 §6).
// Fase 025.5.5 (UAT-21): estado del statement calculado POR FILA, nunca
// una bandera manual — "accionable" = una fila que todavía puede
// terminar en un pago (MATCHED listo, o UNMATCHED/AMBIGUOUS/INVALID que
// un ADMIN puede resolver via match manual). IGNORED/DUPLICATE/APPLIED
// son terminales: nunca vuelven a contarse como accionables (ver
// docs — reabrir una fila IGNORED queda fuera de alcance de esta fase).
function computeStatementStatus(counts: {
  totalRows: number;
  appliedRows: number;
  actionableRows: number;
}): Extract<
  CommissionStatementStatus,
  "PENDING_REVIEW" | "PARTIALLY_APPLIED" | "COMPLETED" | "CLOSED_WITH_SKIPPED_ROWS"
> {
  if (counts.actionableRows > 0) {
    return counts.appliedRows === 0 ? "PENDING_REVIEW" : "PARTIALLY_APPLIED";
  }
  return counts.appliedRows === counts.totalRows ? "COMPLETED" : "CLOSED_WITH_SKIPPED_ROWS";
}

async function recomputeStatementCounts(tx: Prisma.TransactionClient, statementId: string) {
  const matchedRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "MATCHED" } });
  const unmatchedRows = await tx.commissionStatementRow.count({
    where: { statementId, matchStatus: { in: ["UNMATCHED", "INVALID", "DUPLICATE"] } },
  });
  const ambiguousRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "AMBIGUOUS" } });
  const appliedRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "APPLIED" } });
  const ignoredRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "IGNORED" } });
  const duplicateRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "DUPLICATE" } });
  const totalRows = await tx.commissionStatementRow.count({ where: { statementId } });
  const actionableRows = totalRows - appliedRows - ignoredRows - duplicateRows;
  const status = computeStatementStatus({ totalRows, appliedRows, actionableRows });

  const current = await tx.commissionStatement.findUniqueOrThrow({
    where: { id: statementId },
    select: { firstAppliedAt: true },
  });
  await tx.commissionStatement.update({
    where: { id: statementId },
    data: {
      matchedRows,
      unmatchedRows,
      ambiguousRows,
      appliedRows,
      status,
      firstAppliedAt: current.firstAppliedAt ?? (appliedRows > 0 ? new Date() : null),
    },
  });
}

// ---------------------------------------------------------------------------
// Apply — crea CommissionPayment real para cada fila MATCHED. Nunca
// procesa una fila ya APPLIED (protección de duplicado natural: la
// consulta de abajo excluye matchStatus=APPLIED, así que una segunda
// llamada a applyStatement sobre el mismo statement no reprocesa nada
// -- ver test de idempotencia).
// ---------------------------------------------------------------------------
export async function applyCommissionStatement(actor: AuthorizedUser, rawId: unknown) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  const id = parseOrThrow(commissionStatementIdSchema, rawId);

  const statement = await prisma.commissionStatement.findUnique({
    where: { id },
    select: { id: true, status: true, payerAgency: true, totalRows: true, carrierRecognized: true, footerAmbiguous: true },
  });
  if (!statement) throw new AppError("NOT_FOUND", "Reporte no encontrado.");
  if (statement.status === "DUPLICATE_BLOCKED") {
    throw new AppError("VALIDATION_ERROR", "Este reporte está bloqueado por ser un posible duplicado.");
  }
  // Fase 025.5.3: un carrier detectado que no existe en el catálogo
  // (nunca se crea uno automáticamente) bloquea el apply — el preview
  // sigue disponible para que el ADMIN revise qué se detectó.
  if (statement.carrierRecognized === false) {
    throw new AppError(
      "VALIDATION_ERROR",
      "El carrier detectado en este reporte no existe en el catálogo — no se puede aplicar hasta que un ADMIN lo revise."
    );
  }
  // Fase 025.5.5 (TOTAL GENERAL EN REPORTES MULTIPÁGINA): el total
  // declarado en el pie del PDF no reconcilia con la suma de las filas
  // efectivamente mostradas en el preview (típico de un reporte
  // multipágina donde el "Total" detectado resultó ser un subtotal de
  // página) — nunca se asume que igual es correcto. El preview sigue
  // disponible para revisión manual, pero el apply queda bloqueado
  // hasta que un ADMIN confirme el total real fuera de este flujo
  // automático.
  if (statement.footerAmbiguous) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Total general no verificable — el total declarado en el reporte no coincide con la suma de las filas mostradas en el preview. No se puede aplicar hasta revisión manual."
    );
  }
  // Fase 025.5.2 (Corrección 3) — mismo invariante que
  // getCommissionStatementPreview: nunca se aplica un reporte cuya
  // cantidad real de filas no coincide con lo registrado al subirlo.
  const actualRowCount = await prisma.commissionStatementRow.count({ where: { statementId: id } });
  if (actualRowCount !== statement.totalRows) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Error de integridad: el reporte registra ${statement.totalRows} fila(s) pero se encontraron ${actualRowCount} — no se puede aplicar hasta revisar manualmente.`
    );
  }
  // payerAgency solo lo fijan los 3 adaptadores PDF reales (Fase 025.5),
  // que son EXCLUSIVAMENTE HEALTH — los adaptadores CSV/XLSX genéricos
  // de Fase 020 no declaran agencia/modalidad y nunca tuvieron esta
  // restricción, así que la revalidación de abajo nunca los alcanza.
  const requiresHealthOnly = statement.payerAgency !== null;

  // Fase 025.5.5 (UAT-21): la lista de candidatas se relee DENTRO de la
  // transacción (nunca antes) y cada fila se marca APPLIED mediante un
  // updateMany CONDICIONADO a que su matchStatus siga siendo MATCHED
  // justo antes de crear el pago — el UPDATE toma el lock de fila de
  // Postgres, así que dos ADMIN aplicando el mismo statement en
  // paralelo nunca pueden crear dos pagos para la misma fila: la
  // segunda transacción espera a que la primera confirme, relee el
  // estado ya APPLIED y descarta la fila (`guard.count === 0`) en vez
  // de reprocesarla. `CommissionPayment.statementRowId` es además
  // @unique como segunda barrera de defensa en profundidad.
  let appliedCount = 0;
  let grossAmount = new Prisma.Decimal(0);
  let assistanceAmount = new Prisma.Decimal(0);
  let netAmount = new Prisma.Decimal(0);
  await prisma.$transaction(async (tx) => {
    const rowsToApply = await tx.commissionStatementRow.findMany({
      where: { statementId: id, matchStatus: "MATCHED", matchedPolicyId: { not: null } },
      select: {
        id: true,
        matchedPolicyId: true,
        matchedExpectationId: true,
        receivedAmount: true,
        assistanceAmount: true,
        netAmount: true,
        paidAt: true,
        effectiveDate: true,
      },
    });

    for (const row of rowsToApply) {
      const guard = await tx.commissionStatementRow.updateMany({
        where: { id: row.id, matchStatus: "MATCHED" },
        data: { matchStatus: "APPLIED" },
      });
      if (guard.count === 0) continue; // otra aplicación concurrente ya la resolvió
      // Fase 025.5.5 (UAT-16/17): un pago real puede llegar ANTES de
      // que exista una CommissionExpectation para esa Policy+período —
      // ya NO se salta la fila por falta de expectativa (antes de esta
      // fase, `continue` aquí dejaba la fila MATCHED-pero-nunca-aplicada
      // para siempre). Se aplica igual, con commissionExpectationId
      // null; cuando se cree la expectativa correspondiente,
      // commission-payment-linking.ts la vincula retroactivamente sin
      // tocar el monto/fecha ya registrados (nunca se inventa la
      // expectativa aquí).
      const period = inferPeriod({
        source: "",
        receivedAmount: "0",
        sourceRowNumber: 0,
        paidAt: row.paidAt,
        effectiveDate: row.effectiveDate,
      });
      if (!period) {
        await tx.commissionStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: "INVALID",
            errorCode: "No se pudo determinar el período de comisión (sin Paid At ni Effective Date) — no se creó el pago.",
          },
        });
        continue;
      }

      // Fase 025.5.1 (PENDIENTE 025.5-D): revalidación defensiva en el
      // momento de aplicar — un pago PDF (siempre HEALTH, ver
      // requiresHealthOnly arriba) nunca se aplica contra una póliza que
      // dejó de ser HEALTH entre el matching y el apply (caso extremo,
      // pero nunca se asume que el estado en preview sigue vigente sin
      // volver a confirmarlo).
      if (requiresHealthOnly) {
        const policyCheck = await tx.policy.findUnique({
          where: { id: row.matchedPolicyId! },
          select: { product: { select: { policyType: true } } },
        });
        if (policyCheck?.product.policyType !== "HEALTH") {
          await tx.commissionStatementRow.update({
            where: { id: row.id },
            data: {
              matchStatus: "INVALID",
              errorCode: "La póliza emparejada ya no es HEALTH — revalidado al aplicar, no se creó el pago.",
            },
          });
          continue;
        }
      }

      const policy = await tx.policy.findUniqueOrThrow({
        where: { id: row.matchedPolicyId! },
        select: { holderId: true, householdId: true },
      });

      const payment = await tx.commissionPayment.create({
        data: {
          commissionExpectationId: row.matchedExpectationId, // null es válido — ver UAT-16/17 arriba
          policyId: row.matchedPolicyId!,
          period,
          amount: row.receivedAmount,
          type: "PAYMENT",
          // Paid At es la fecha real del pago cuando el adapter la
          // provee; Effective Date es solo un fallback conservador, y
          // la fecha de carga del statement es el último recurso —
          // nunca se asume más de lo que el reporte realmente dice
          // (§19 de la ficha).
          receivedAt: row.paidAt ?? row.effectiveDate ?? new Date(),
          statementRowId: row.id,
        },
      });

      await recordAuditEvent(tx, {
        actor,
        entityType: "CommissionPayment",
        entityId: payment.id,
        action: "COMMISSION_PAYMENT_FROM_STATEMENT",
        policyId: row.matchedPolicyId!,
        householdId: policy.householdId,
        contactPersonId: policy.holderId,
        summary: row.matchedExpectationId
          ? "Pago de comisión aplicado desde reporte de conciliación"
          : "Pago de comisión aplicado desde reporte de conciliación (sin expectativa todavía — se vinculará automáticamente cuando se cree)",
        metadata: { statementRowId: row.id },
      });
      appliedCount++;
      grossAmount = grossAmount.plus(row.receivedAmount);
      assistanceAmount = assistanceAmount.plus(row.assistanceAmount);
      netAmount = netAmount.plus(row.netAmount);
    }

    // Fase 025.5.5 (UAT-21): un batch solo se registra si esta llamada
    // realmente aplicó algo — una segunda llamada sin filas nuevas
    // listas (doble clic, reintento, o ya no queda nada por aplicar)
    // es un no-op silencioso, nunca crea un batch vacío ni mueve
    // `appliedAt`. El historial de aplicaciones nunca se sobrescribe:
    // cada llamada exitosa agrega un registro nuevo, inmutable.
    if (appliedCount > 0) {
      await tx.commissionStatementApplyBatch.create({
        data: {
          statementId: id,
          appliedById: actor.id,
          rowsApplied: appliedCount,
          paymentsCreated: appliedCount,
          grossAmount: grossAmount.toFixed(2),
          assistanceAmount: assistanceAmount.toFixed(2),
          netAmount: netAmount.toFixed(2),
        },
      });
      await tx.commissionStatement.update({ where: { id }, data: { appliedAt: new Date() } });
      await recordAuditEvent(tx, {
        actor,
        entityType: "CommissionStatement",
        entityId: id,
        action: "COMMISSION_STATEMENT_APPLY",
        summary: `Reporte de comisiones aplicado parcialmente (${appliedCount} pagos creados en esta aplicación)`,
        metadata: { appliedCount },
      });
    }
    await recomputeStatementCounts(tx, id);
  });

  return getCommissionStatementPreview(actor, id);
}
