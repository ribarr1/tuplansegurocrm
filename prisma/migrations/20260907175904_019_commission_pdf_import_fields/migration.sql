-- CreateEnum
CREATE TYPE "CommissionPayerAgency" AS ENUM ('ORANGE', 'ELITE');

-- CreateEnum
CREATE TYPE "CommissionBusinessModality" AS ENUM ('OWN', 'REFERRAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionStatementRowMatchStatus" ADD VALUE 'INVALID';
ALTER TYPE "CommissionStatementRowMatchStatus" ADD VALUE 'DUPLICATE';

-- AlterTable
ALTER TABLE "commission_statement_rows" ADD COLUMN     "assistanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rowFingerprint" TEXT;

-- AlterTable
ALTER TABLE "commission_statements" ADD COLUMN     "adapterVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "assistanceTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "businessModality" "CommissionBusinessModality",
ADD COLUMN     "declaredFooterTotal" DECIMAL(12,2),
ADD COLUMN     "footerMatchesNet" BOOLEAN,
ADD COLUMN     "netTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payerAgency" "CommissionPayerAgency";

-- CreateIndex
CREATE INDEX "commission_statement_rows_rowFingerprint_idx" ON "commission_statement_rows"("rowFingerprint");
