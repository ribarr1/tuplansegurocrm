import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizedUser } from "@/lib/authorization";
import { recordAuditEvent } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Fase 025.5.5 (UAT-16/17) — un CommissionPayment puede existir ANTES
// de que exista la CommissionExpectation correspondiente (el reporte
// del carrier no espera a que nosotros registremos la expectativa).
// Cuando se crea la expectativa de una Policy+período, esta función
// vincula RETROACTIVAMENTE los pagos pendientes que ya existían para
// ese mismo (Policy, período) — nunca crea pagos nuevos, nunca
// modifica monto/fecha/asistencia históricos, nunca inventa una
// expectativa. Debe llamarse DENTRO de la misma transacción que crea
// la CommissionExpectation, inmediatamente después de crearla.
// ---------------------------------------------------------------------------
export async function linkPendingPaymentsToExpectation(
  tx: Prisma.TransactionClient,
  params: { expectationId: string; policyId: string; period: Date; actor: AuthorizedUser | null }
): Promise<number> {
  const pendingPayments = await tx.commissionPayment.findMany({
    where: { policyId: params.policyId, period: params.period, commissionExpectationId: null },
    select: { id: true, statementRowId: true },
  });
  if (pendingPayments.length === 0) return 0;

  await tx.commissionPayment.updateMany({
    where: { id: { in: pendingPayments.map((p) => p.id) } },
    data: { commissionExpectationId: params.expectationId },
  });

  // Actualiza también la fila de origen del reporte (si la hay) para
  // que el preview de conciliación quede consistente con la vista de
  // Comisiones — nunca dos fuentes de verdad divergentes sobre si una
  // fila ya está conciliada.
  const rowIds = pendingPayments.map((p) => p.statementRowId).filter((rowId): rowId is string => !!rowId);
  if (rowIds.length > 0) {
    await tx.commissionStatementRow.updateMany({
      where: { id: { in: rowIds } },
      data: { matchedExpectationId: params.expectationId },
    });
  }

  await recordAuditEvent(tx, {
    actor: params.actor,
    entityType: "CommissionExpectation",
    entityId: params.expectationId,
    action: "COMMISSION_EXPECTATION_LINKED_PENDING_PAYMENTS",
    policyId: params.policyId,
    summary: `${pendingPayments.length} pago(s) previamente sin expectativa se vincularon a la expectativa recién creada`,
    metadata: { linkedPaymentCount: pendingPayments.length },
  });

  return pendingPayments.length;
}
