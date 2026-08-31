-- CreateEnum
CREATE TYPE "CommissionExpectationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionPaymentType" AS ENUM ('PAYMENT', 'CHARGEBACK', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "commission_expectations" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "agentId" UUID,
    "period" DATE NOT NULL,
    "expectedAmount" DECIMAL(12,2) NOT NULL,
    "status" "CommissionExpectationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_expectations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payments" (
    "id" UUID NOT NULL,
    "commissionExpectationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "CommissionPaymentType" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "externalReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_expectations_period_idx" ON "commission_expectations"("period");

-- CreateIndex
CREATE INDEX "commission_expectations_agentId_period_idx" ON "commission_expectations"("agentId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "commission_expectations_policyId_period_key" ON "commission_expectations"("policyId", "period");

-- CreateIndex
CREATE INDEX "commission_payments_commissionExpectationId_idx" ON "commission_payments"("commissionExpectationId");

-- CreateIndex
CREATE INDEX "commission_payments_receivedAt_idx" ON "commission_payments"("receivedAt");

-- AddForeignKey
ALTER TABLE "commission_expectations" ADD CONSTRAINT "commission_expectations_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_expectations" ADD CONSTRAINT "commission_expectations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_commissionExpectationId_fkey" FOREIGN KEY ("commissionExpectationId") REFERENCES "commission_expectations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint
-- expectedAmount representa ingreso anticipado: nunca negativo. Los
-- ajustes/chargebacks negativos viven en CommissionPayment, no aquí.
-- No expresable en schema.prisma (sin soporte estable para CHECK),
-- agregado manualmente a esta migración antes de aplicarla.
ALTER TABLE "commission_expectations" ADD CONSTRAINT "commission_expectations_expectedAmount_check" CHECK ("expectedAmount" >= 0);
