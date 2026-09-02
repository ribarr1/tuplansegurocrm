-- AlterTable
ALTER TABLE "commission_expectations" ADD COLUMN     "calculatedAmount" DECIMAL(12,2),
ADD COLUMN     "generatedByRuleId" UUID,
ADD COLUMN     "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overriddenById" UUID,
ADD COLUMN     "overrideReason" TEXT;

-- CreateIndex
CREATE INDEX "commission_expectations_generatedByRuleId_idx" ON "commission_expectations"("generatedByRuleId");

-- AddForeignKey
ALTER TABLE "commission_expectations" ADD CONSTRAINT "commission_expectations_generatedByRuleId_fkey" FOREIGN KEY ("generatedByRuleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_expectations" ADD CONSTRAINT "commission_expectations_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
