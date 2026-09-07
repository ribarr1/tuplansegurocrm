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
import { matchStatementRow, findExpectationForPolicy, inferPeriod, type MatchResult } from "./matcher";
import { normalizeCarrierForComparison, MultipleCarriersError } from "./carrier-detection";
import { PdfParseError, PdfTooManyPagesError, PdfTooManyRowsError, PdfFormatMismatchError } from "./pdf-table-extract";
import type { NormalizedCommissionRow } from "./types";
import { Prisma } from "@/generated/prisma/client";

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
  payerAgency: true,
  businessModality: true,
  assistanceTotal: true,
  netTotal: true,
  declaredFooterTotal: true,
  footerMatchesNet: true,
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
  errorCode: true,
  metadata: true,
  matchedPolicy: {
    select: {
      id: true,
      policyNumber: true,
      businessSource: true,
      holder: { select: { id: true, firstName: true, lastName: true } },
      product: { select: { carrier: { select: { name: true } } } },
    },
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

  const statementId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.commissionStatement.create({
      data: {
        id: statementId,
        source,
        fileName,
        fingerprint,
        uploadedById: actor.id,
        status: "PREVIEW",
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

export async function listCommissionStatements(actor: AuthorizedUser) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  return prisma.commissionStatement.findMany({
    select: statementSelect,
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });
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

  const enriched = rows.map((row) => {
    const expected = row.matchedExpectation?.expectedAmount ?? null;
    const received = new Prisma.Decimal(row.receivedAmount);
    const difference = expected ? received.minus(new Prisma.Decimal(expected)) : null;
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
                : !row.matchedExpectationId
                  ? "NO_EXPECTATION"
                  : difference === null
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
      receivedAmount: row.receivedAmount,
      assistanceAmount: row.assistanceAmount,
      netAmount: row.netAmount,
      expectedAmount: expected,
      difference: difference ? difference.toFixed(2) : null,
      matchStatus: row.matchStatus,
      reviewState,
      errorCode: row.errorCode,
      matchedPolicy: row.matchedPolicy,
      alreadyApplied: !!row.payment,
    };
  });

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

  return { statement, rows: enriched, integrityError };
}

// Candidatos elegibles para un match manual (filas UNMATCHED/AMBIGUOUS)
// — búsqueda simple por nombre, misma UX que el resto de la app
// (nunca una lista global sin filtro).
export async function searchPoliciesForManualMatch(actor: AuthorizedUser, search: string) {
  assertModuleAccess(actor);
  assertAdminOnly(actor);
  if (!search || search.trim().length < 2) return [];
  return prisma.policy.findMany({
    where: {
      OR: [
        { holder: { firstName: { contains: search, mode: "insensitive" } } },
        { holder: { lastName: { contains: search, mode: "insensitive" } } },
        { policyNumber: { contains: search, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      policyNumber: true,
      holder: { select: { firstName: true, lastName: true } },
      product: { select: { carrier: { select: { name: true } } } },
    },
    take: 10,
  });
}

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

  const policy = await prisma.policy.findUnique({ where: { id: input.policyId }, select: { id: true } });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");

  const normalizedRow: NormalizedCommissionRow = {
    source: "", // no se usa dentro de findExpectationForPolicy
    receivedAmount: "0",
    sourceRowNumber: 0,
    effectiveDate: row.effectiveDate,
    paidAt: row.paidAt,
  };
  const expectationId = await findExpectationForPolicy(input.policyId, normalizedRow);

  const statement = await prisma.commissionStatement.findUniqueOrThrow({
    where: { id: row.statementId },
    select: { source: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.commissionStatementRow.update({
      where: { id: rowId },
      data: { matchStatus: "MATCHED", matchedPolicyId: input.policyId, matchedExpectationId: expectationId },
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
      summary: "Fila de reporte emparejada manualmente con una póliza",
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
async function recomputeStatementCounts(tx: Prisma.TransactionClient, statementId: string) {
  const matchedRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "MATCHED" } });
  const unmatchedRows = await tx.commissionStatementRow.count({
    where: { statementId, matchStatus: { in: ["UNMATCHED", "INVALID", "DUPLICATE"] } },
  });
  const ambiguousRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "AMBIGUOUS" } });
  const appliedRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "APPLIED" } });
  await tx.commissionStatement.update({
    where: { id: statementId },
    data: { matchedRows, unmatchedRows, ambiguousRows, appliedRows },
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
    select: { id: true, status: true, payerAgency: true, totalRows: true, carrierRecognized: true },
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

  const rowsToApply = await prisma.commissionStatementRow.findMany({
    where: { statementId: id, matchStatus: "MATCHED", matchedPolicyId: { not: null } },
    select: {
      id: true,
      matchedPolicyId: true,
      matchedExpectationId: true,
      receivedAmount: true,
      paidAt: true,
      effectiveDate: true,
    },
  });

  let appliedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of rowsToApply) {
      // Sin expectativa resuelta: no hay a qué CommissionExpectation
      // adjuntar el pago — se deja para resolución manual (NO_EXPECTATION
      // en el preview), nunca se inventa una expectativa aquí.
      if (!row.matchedExpectationId) continue;

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

      const payment = await tx.commissionPayment.create({
        data: {
          commissionExpectationId: row.matchedExpectationId,
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
      await tx.commissionStatementRow.update({
        where: { id: row.id },
        data: { matchStatus: "APPLIED" },
      });

      const expectation = await tx.commissionExpectation.findUniqueOrThrow({
        where: { id: row.matchedExpectationId },
        select: { policyId: true, policy: { select: { holderId: true, householdId: true } } },
      });
      await recordAuditEvent(tx, {
        actor,
        entityType: "CommissionPayment",
        entityId: payment.id,
        action: "COMMISSION_PAYMENT_FROM_STATEMENT",
        policyId: expectation.policyId,
        householdId: expectation.policy.householdId,
        contactPersonId: expectation.policy.holderId,
        summary: "Pago de comisión aplicado desde reporte de conciliación",
        metadata: { statementRowId: row.id },
      });
      appliedCount++;
    }

    await tx.commissionStatement.update({
      where: { id },
      data: { status: "APPLIED", appliedAt: new Date() },
    });
    await recomputeStatementCounts(tx, id);
    await recordAuditEvent(tx, {
      actor,
      entityType: "CommissionStatement",
      entityId: id,
      action: "COMMISSION_STATEMENT_APPLY",
      summary: `Reporte de comisiones aplicado (${appliedCount} pagos creados)`,
      metadata: { appliedCount },
    });
  });

  return getCommissionStatementPreview(actor, id);
}
