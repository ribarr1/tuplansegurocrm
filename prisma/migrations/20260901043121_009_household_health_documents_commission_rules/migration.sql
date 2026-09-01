-- CreateEnum
CREATE TYPE "HealthCoverageSource" AS ENUM ('MARKETPLACE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PolicyDocumentType" AS ENUM ('PLAN_SUMMARY', 'BROCHURE', 'FORMULARY', 'PROVIDER_DIRECTORY', 'MEMBER_CARD', 'APPLICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionMethod" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "CommissionBase" AS ENUM ('PREMIUM_MONTHLY', 'PREMIUM_ANNUALIZED', 'PER_MEMBER', 'FIXED', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionPeriodicity" AS ENUM ('ONE_TIME', 'MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "households" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "annualHouseholdIncome" DECIMAL(12,2),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "county" TEXT,
ADD COLUMN     "incomeYear" INTEGER,
ADD COLUMN     "state" VARCHAR(2),
ADD COLUMN     "zipCode" TEXT;

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "healthCoverageSource" "HealthCoverageSource";

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "type" "PolicyDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "policyId" UUID,
    "method" "CommissionMethod" NOT NULL,
    "base" "CommissionBase" NOT NULL,
    "initialAmount" DECIMAL(12,2),
    "initialPercentage" DECIMAL(5,2),
    "initialPeriodicity" "CommissionPeriodicity" NOT NULL,
    "residualEnabled" BOOLEAN NOT NULL DEFAULT false,
    "residualAmount" DECIMAL(12,2),
    "residualPercentage" DECIMAL(5,2),
    "residualPeriodicity" "CommissionPeriodicity",
    "residualStartYear" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_storageKey_key" ON "policy_documents"("storageKey");

-- CreateIndex
CREATE INDEX "policy_documents_policyId_idx" ON "policy_documents"("policyId");

-- CreateIndex
CREATE INDEX "commission_rules_productId_idx" ON "commission_rules"("productId");

-- CreateIndex
CREATE INDEX "commission_rules_policyId_idx" ON "commission_rules"("policyId");

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
