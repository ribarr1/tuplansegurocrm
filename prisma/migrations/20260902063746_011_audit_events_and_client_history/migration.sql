-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

-- AlterEnum
ALTER TYPE "PolicyOperationType" ADD VALUE 'REPLACEMENT';

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "contactPersonId" UUID,
    "policyId" UUID,
    "householdId" UUID,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_contactPersonId_createdAt_idx" ON "audit_events"("contactPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_policyId_createdAt_idx" ON "audit_events"("policyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_householdId_createdAt_idx" ON "audit_events"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_createdAt_idx" ON "audit_events"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;
