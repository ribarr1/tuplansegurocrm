-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'RENEWED');

-- CreateEnum
CREATE TYPE "PolicyOperationType" AS ENUM ('NEW_ENROLLMENT', 'RENEWAL', 'PLAN_CHANGE');

-- CreateEnum
CREATE TYPE "PolicyMemberRole" AS ENUM ('PRIMARY', 'SPOUSE', 'DEPENDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CURRENT', 'DUE', 'PAST_DUE');

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "holderId" UUID NOT NULL,
    "householdId" UUID,
    "productId" UUID NOT NULL,
    "policyNumber" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveDate" DATE NOT NULL,
    "terminationDate" DATE,
    "previousPolicyId" UUID,
    "processedById" UUID,
    "premiumAmount" DECIMAL(12,2),
    "billingFrequency" "BillingFrequency",
    "nextPaymentDueDate" DATE,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "needsPaymentAssistance" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" "PaymentStatus",
    "operationType" "PolicyOperationType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_members" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "PolicyMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_policy_details" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "marketplaceApplicationId" TEXT,
    "marketplaceState" VARCHAR(2),
    "planNameSnapshot" TEXT,
    "taxCreditAmount" DECIMAL(12,2),
    "incomeUsed" DECIMAL(12,2),
    "deductibleIndividual" DECIMAL(12,2),
    "deductibleFamily" DECIMAL(12,2),
    "outOfPocketIndividual" DECIMAL(12,2),
    "outOfPocketFamily" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_policy_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policies_previousPolicyId_key" ON "policies"("previousPolicyId");

-- CreateIndex
CREATE INDEX "policies_holderId_idx" ON "policies"("holderId");

-- CreateIndex
CREATE INDEX "policies_productId_idx" ON "policies"("productId");

-- CreateIndex
CREATE INDEX "policies_status_idx" ON "policies"("status");

-- CreateIndex
CREATE INDEX "policies_effectiveDate_idx" ON "policies"("effectiveDate");

-- CreateIndex
CREATE INDEX "policies_policyNumber_idx" ON "policies"("policyNumber");

-- CreateIndex
CREATE INDEX "policy_members_personId_idx" ON "policy_members"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_members_policyId_personId_key" ON "policy_members"("policyId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "health_policy_details_policyId_key" ON "health_policy_details"("policyId");

-- CreateIndex
CREATE INDEX "health_policy_details_marketplaceApplicationId_idx" ON "health_policy_details"("marketplaceApplicationId");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_previousPolicyId_fkey" FOREIGN KEY ("previousPolicyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_policy_details" ADD CONSTRAINT "health_policy_details_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
