-- CreateEnum
CREATE TYPE "CommissionStatementStatus" AS ENUM ('PREVIEW', 'APPLIED', 'DUPLICATE_BLOCKED');

-- CreateEnum
CREATE TYPE "CommissionStatementRowMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'IGNORED', 'APPLIED');

-- AlterTable
ALTER TABLE "commission_payments" ADD COLUMN     "statementRowId" UUID;

-- CreateTable
CREATE TABLE "policy_external_references" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_external_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_statements" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "statementPeriod" TEXT,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CommissionStatementStatus" NOT NULL DEFAULT 'PREVIEW',
    "totalRows" INTEGER NOT NULL,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "ambiguousRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "receivedTotal" DECIMAL(12,2) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "commission_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_statement_rows" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT,
    "receivedAmount" DECIMAL(12,2) NOT NULL,
    "effectiveDate" DATE,
    "paidAt" DATE,
    "matchStatus" "CommissionStatementRowMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedPolicyId" UUID,
    "matchedExpectationId" UUID,
    "errorCode" TEXT,
    "metadata" JSONB,

    CONSTRAINT "commission_statement_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_external_references_policyId_idx" ON "policy_external_references"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_external_references_source_type_externalId_key" ON "policy_external_references"("source", "type", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_statements_fingerprint_key" ON "commission_statements"("fingerprint");

-- CreateIndex
CREATE INDEX "commission_statements_source_uploadedAt_idx" ON "commission_statements"("source", "uploadedAt");

-- CreateIndex
CREATE INDEX "commission_statement_rows_statementId_idx" ON "commission_statement_rows"("statementId");

-- CreateIndex
CREATE INDEX "commission_statement_rows_matchedPolicyId_idx" ON "commission_statement_rows"("matchedPolicyId");

-- CreateIndex
CREATE INDEX "commission_statement_rows_matchedExpectationId_idx" ON "commission_statement_rows"("matchedExpectationId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_payments_statementRowId_key" ON "commission_payments"("statementRowId");

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_statementRowId_fkey" FOREIGN KEY ("statementRowId") REFERENCES "commission_statement_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_external_references" ADD CONSTRAINT "policy_external_references_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_rows" ADD CONSTRAINT "commission_statement_rows_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "commission_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_rows" ADD CONSTRAINT "commission_statement_rows_matchedPolicyId_fkey" FOREIGN KEY ("matchedPolicyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_rows" ADD CONSTRAINT "commission_statement_rows_matchedExpectationId_fkey" FOREIGN KEY ("matchedExpectationId") REFERENCES "commission_expectations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

