-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionStatementStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "CommissionStatementStatus" ADD VALUE 'PARTIALLY_APPLIED';
ALTER TYPE "CommissionStatementStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "CommissionStatementStatus" ADD VALUE 'CLOSED_WITH_SKIPPED_ROWS';

-- AlterTable
ALTER TABLE "commission_statements" ADD COLUMN     "firstAppliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commission_statement_apply_batches" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "appliedById" UUID,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsApplied" INTEGER NOT NULL,
    "paymentsCreated" INTEGER NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "assistanceAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "commission_statement_apply_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_statement_apply_batches_statementId_idx" ON "commission_statement_apply_batches"("statementId");

-- AddForeignKey
ALTER TABLE "commission_statement_apply_batches" ADD CONSTRAINT "commission_statement_apply_batches_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "commission_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_apply_batches" ADD CONSTRAINT "commission_statement_apply_batches_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
