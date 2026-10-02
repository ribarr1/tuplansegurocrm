-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('GOOGLE', 'META', 'WEB', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('LEAD', 'PROSPECT', 'CLIENT');

-- CreateEnum
CREATE TYPE "LeadFollowUpStatus" AS ENUM ('NEW', 'IN_FOLLOW_UP', 'CONTACTED', 'QUOTE_SENT', 'AWAITING_DECISION', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LeadCloseReason" AS ENUM ('NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_DATA', 'NOT_ELIGIBLE', 'DOES_NOT_WANT_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'NOTE');

-- CreateEnum
CREATE TYPE "LeadAssignmentMechanism" AS ENUM ('MANUAL');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "leadId" UUID;

-- CreateTable
CREATE TABLE "lead_integration_credentials" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "credentialKey" TEXT NOT NULL,
    "hashedSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "lead_integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "email" TEXT,
    "residenceState" TEXT,
    "productInterest" "PolicyType",
    "source" "LeadSource" NOT NULL,
    "integrationCredentialId" UUID,
    "externalId" TEXT,
    "idempotencyKey" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "originalInquiryAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentGiven" BOOLEAN,
    "consentText" TEXT,
    "consentDate" TIMESTAMP(3),
    "consentSource" TEXT,
    "formResponses" JSONB,
    "stage" "LeadStage" NOT NULL DEFAULT 'LEAD',
    "followUpStatus" "LeadFollowUpStatus" NOT NULL DEFAULT 'NEW',
    "closeReason" "LeadCloseReason",
    "closeReasonDetail" TEXT,
    "assignedToId" UUID,
    "linkedPersonId" UUID,
    "convertedPolicyId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorUserId" UUID NOT NULL,
    "outcome" TEXT,
    "note" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignment_history" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "previousAgentId" UUID,
    "newAgentId" UUID,
    "mechanism" "LeadAssignmentMechanism" NOT NULL DEFAULT 'MANUAL',
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "lead_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_integration_credentials_credentialKey_key" ON "lead_integration_credentials"("credentialKey");

-- CreateIndex
CREATE UNIQUE INDEX "leads_convertedPolicyId_key" ON "leads"("convertedPolicyId");

-- CreateIndex
CREATE INDEX "leads_phoneNormalized_idx" ON "leads"("phoneNormalized");

-- CreateIndex
CREATE INDEX "leads_assignedToId_idx" ON "leads"("assignedToId");

-- CreateIndex
CREATE INDEX "leads_stage_followUpStatus_idx" ON "leads"("stage", "followUpStatus");

-- CreateIndex
CREATE INDEX "leads_receivedAt_idx" ON "leads"("receivedAt");

-- CreateIndex
CREATE INDEX "leads_linkedPersonId_idx" ON "leads"("linkedPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_integrationCredentialId_externalId_key" ON "leads"("integrationCredentialId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_integrationCredentialId_idempotencyKey_key" ON "leads"("integrationCredentialId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_occurredAt_idx" ON "lead_activities"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_assignment_history_leadId_assignedAt_idx" ON "lead_assignment_history"("leadId", "assignedAt");

-- CreateIndex
CREATE INDEX "tasks_leadId_idx" ON "tasks"("leadId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_integration_credentials" ADD CONSTRAINT "lead_integration_credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_integrationCredentialId_fkey" FOREIGN KEY ("integrationCredentialId") REFERENCES "lead_integration_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_linkedPersonId_fkey" FOREIGN KEY ("linkedPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedPolicyId_fkey" FOREIGN KEY ("convertedPolicyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_previousAgentId_fkey" FOREIGN KEY ("previousAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_newAgentId_fkey" FOREIGN KEY ("newAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
