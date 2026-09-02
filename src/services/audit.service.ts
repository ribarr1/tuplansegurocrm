import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Auditoría de acciones — Fase 019.9 (§10-§14, §21-§23).
//
// AuditEvent es un log append-only (nunca update/delete desde código de
// aplicación — ver docs/AUDIT_TRAIL.md) que respalda dos cosas
// distintas: el "Historial" visible al usuario (Contact/Policy Detail)
// y una auditoría técnica de quién hizo qué. NUNCA reemplaza a Note
// (texto manual del agente) — un AuditEvent se genera automáticamente
// por el sistema al ocurrir un cambio, nunca lo escribe un humano
// directamente.
//
// Uso típico (atómico con la escritura real, mismo criterio ya
// establecido para el pg-concurrency bug de Ticket A: queries dentro de
// una transacción interactiva SIEMPRE secuenciales, nunca Promise.all):
//
//   const result = await prisma.$transaction(async (tx) => {
//     const updated = await tx.entity.update({ ... });
//     await recordAuditEvent(tx, { actor, entityType: "...", ... });
//     return updated;
//   });
// ---------------------------------------------------------------------------

type Db = typeof prisma | Prisma.TransactionClient;

export type AuditChanges = Record<string, { before: unknown; after: unknown }>;

export interface RecordAuditEventInput {
  // null explícito cuando la acción la generó el sistema (ej. import
  // legacy), nunca se inventa un actor humano para una acción del
  // sistema.
  actor: AuthorizedUser | null;
  entityType: string;
  entityId: string;
  action: string;
  contactPersonId?: string | null;
  policyId?: string | null;
  householdId?: string | null;
  summary: string;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(db: Db, input: RecordAuditEventInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorUserId: input.actor?.id ?? null,
      actorType: input.actor ? "USER" : "SYSTEM",
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      contactPersonId: input.contactPersonId ?? null,
      policyId: input.policyId ?? null,
      householdId: input.householdId ?? null,
      summary: input.summary,
      changes: (input.changes as Prisma.InputJsonValue | undefined) ?? undefined,
      metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
}

// Serializa un valor para guardarlo en `changes` — nunca el objeto
// Prisma crudo. Decimal -> string (nunca perder precisión pasando por
// number); Date -> YYYY-MM-DD (asume columnas @db.Date; ver
// src/lib/date-only.ts sobre por qué un valor date-only nunca debe
// leerse con getters locales — aquí usamos getters UTC por el mismo
// motivo). null/undefined -> null explícito.
function serializeAuditValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
      value.getUTCDate()
    ).padStart(2, "0")}`;
  }
  if (
    typeof value === "object" &&
    "toFixed" in (value as Record<string, unknown>) &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return String(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

// Compara `before`/`after` SOLO en los campos de `fields` (allowlist
// explícita, nunca un diff genérico sobre el objeto completo — así un
// campo sensible que no se pase en `fields` nunca puede terminar en el
// audit log por accidente). Omite campos sin cambio real y campos
// ausentes en `after` (edición parcial: no se propuso tocar ese
// campo). Retorna undefined si no hay ningún cambio real — así el
// caller puede decidir no auditar un UPDATE que en la práctica no
// cambió nada.
// `before`/`after` aceptan formas heterogéneas a propósito (ej. la DB
// guarda `Decimal`/`Date`, el input de un formulario llega como
// `string`) — serializeAuditValue normaliza ambos lados antes de
// comparar, así que no tienen que compartir el mismo tipo exacto.
export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[]
): AuditChanges | undefined {
  const changes: AuditChanges = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const b = serializeAuditValue(before[field]);
    const a = serializeAuditValue(after[field]);
    if (b === a) continue;
    changes[field] = { before: b, after: a };
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}
