import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { recordAuditEvent } from "@/services/audit.service";
import { looksLikeZipArchive } from "@/lib/file-sniff";
import {
  commissionStatementIdSchema,
  commissionStatementRowIdSchema,
  manualMatchRowSchema,
  uploadCommissionStatementSchema,
  MAX_STATEMENT_SIZE_BYTES,
} from "@/schemas/commission-statement.schema";
import { getStatementAdapter } from "./registry";
import { matchStatementRow, findExpectationForPolicy } from "./matcher";
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
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.CommissionStatementSelect;

const rowSelect = {
  id: true,
  rowNumber: true,
  externalId: true,
  displayName: true,
  receivedAmount: true,
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

  let parsed;
  try {
    parsed = await adapter.parse(buffer, fileName);
  } catch (error) {
    throw new AppError(
      "VALIDATION_ERROR",
      `file: ${error instanceof Error ? error.message : "No se pudo leer el archivo."}`
    );
  }

  if (parsed.rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", "file: El archivo no contiene filas reconocibles.");
  }

  const fingerprint = computeFingerprint(source, parsed.rows);
  const existing = await prisma.commissionStatement.findUnique({
    where: { fingerprint },
    select: { id: true },
  });
  if (existing) {
    return { duplicate: true, existingStatementId: existing.id };
  }

  // Matching: lecturas fuera de la transacción (solo SELECTs, sin
  // riesgo de estado a medias); la escritura real (statement + filas +
  // audit event) sí es una sola transacción atómica.
  const matches = await Promise.all(
    // Promise.all aquí es seguro: son llamadas independientes que usan
    // el pool normal de conexiones de Prisma, no una transacción
    // interactiva fijada a una sola conexión (ver el hallazgo de
    // concurrencia de pg, Fase 019.6 — ese problema es específico de
    // $transaction(async tx => ...) / $transaction([...]), no de
    // queries top-level).
    parsed.rows.map((row) => matchStatementRow(source, row))
  );

  let matchedCount = 0;
  let unmatchedCount = 0;
  let ambiguousCount = 0;
  const receivedTotal = parsed.rows
    .reduce((sum, r) => sum.plus(new Prisma.Decimal(r.receivedAmount)), new Prisma.Decimal(0))
    .toFixed(2);

  const rowsData = parsed.rows.map((row, i) => {
    const match = matches[i];
    if (match.status === "MATCHED") matchedCount++;
    else if (match.status === "AMBIGUOUS") ambiguousCount++;
    else unmatchedCount++;

    return {
      id: randomUUID(),
      statementId: "", // se completa abajo tras crear el statement
      rowNumber: row.sourceRowNumber,
      externalId: row.externalMemberId ?? null,
      displayName: row.memberName ?? null,
      receivedAmount: row.receivedAmount,
      effectiveDate: row.effectiveDate ?? null,
      paidAt: row.paidAt ?? null,
      matchStatus: match.status,
      matchedPolicyId: match.status === "MATCHED" ? match.policyId : null,
      matchedExpectationId: match.status === "MATCHED" ? match.expectationId : null,
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
      } as Prisma.InputJsonValue,
    };
  });

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
            : !row.matchedExpectationId
              ? "NO_EXPECTATION"
              : difference === null
                ? "NO_EXPECTATION"
                : difference.isZero()
                  ? "MATCH"
                  : difference.isPositive()
                    ? "OVERPAID"
                    : "UNDERPAID";

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      externalId: row.externalId,
      displayName: row.displayName,
      receivedAmount: row.receivedAmount,
      expectedAmount: expected,
      difference: difference ? difference.toFixed(2) : null,
      matchStatus: row.matchStatus,
      reviewState,
      matchedPolicy: row.matchedPolicy,
      alreadyApplied: !!row.payment,
    };
  });

  return { statement, rows: enriched };
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
  const unmatchedRows = await tx.commissionStatementRow.count({ where: { statementId, matchStatus: "UNMATCHED" } });
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
    select: { id: true, status: true },
  });
  if (!statement) throw new AppError("NOT_FOUND", "Reporte no encontrado.");
  if (statement.status === "DUPLICATE_BLOCKED") {
    throw new AppError("VALIDATION_ERROR", "Este reporte está bloqueado por ser un posible duplicado.");
  }

  const rowsToApply = await prisma.commissionStatementRow.findMany({
    where: { statementId: id, matchStatus: "MATCHED", matchedPolicyId: { not: null } },
    select: {
      id: true,
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
