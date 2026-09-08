-- AlterTable
ALTER TABLE "commission_statement_rows" ADD COLUMN     "matchedPolicyMemberId" UUID;

-- CreateIndex
CREATE INDEX "commission_statement_rows_matchedPolicyMemberId_idx" ON "commission_statement_rows"("matchedPolicyMemberId");

-- AddForeignKey
ALTER TABLE "commission_statement_rows" ADD CONSTRAINT "commission_statement_rows_matchedPolicyMemberId_fkey" FOREIGN KEY ("matchedPolicyMemberId") REFERENCES "policy_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
