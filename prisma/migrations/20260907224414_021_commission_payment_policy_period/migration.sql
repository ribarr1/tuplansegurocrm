-- Fase 025.5.5 (UAT-16/17): CommissionPayment gana un link directo a
-- Policy + un período de comisión normalizado, independientes de si ya
-- existe una CommissionExpectation — permite registrar un pago real
-- ANTES de crear la expectativa correspondiente. Se agregan como
-- columnas NULLABLE primero, se rellenan desde los datos existentes
-- (todo pago histórico ya tiene una CommissionExpectation con
-- policyId/period reales) y solo DESPUÉS se marcan NOT NULL — nunca se
-- pierde ni se inventa un valor para una fila histórica real.

-- AlterTable: agregar columnas nullable + permitir expectativa nula.
ALTER TABLE "commission_payments"
  ADD COLUMN "policyId" UUID,
  ADD COLUMN "period" DATE,
  ALTER COLUMN "commissionExpectationId" DROP NOT NULL;

-- Backfill: todo pago existente ya está vinculado a una expectativa
-- real (commissionExpectationId era NOT NULL hasta ahora) — se copia
-- su policyId/period, nunca se inventa un valor.
UPDATE "commission_payments" cp
SET "policyId" = ce."policyId",
    "period" = ce."period"
FROM "commission_expectations" ce
WHERE cp."commissionExpectationId" = ce."id";

-- Ahora que todas las filas existentes tienen un valor real, se
-- exige NOT NULL para cualquier fila futura (con o sin expectativa).
ALTER TABLE "commission_payments"
  ALTER COLUMN "policyId" SET NOT NULL,
  ALTER COLUMN "period" SET NOT NULL;

-- CreateIndex
CREATE INDEX "commission_payments_policyId_period_idx" ON "commission_payments"("policyId", "period");

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
