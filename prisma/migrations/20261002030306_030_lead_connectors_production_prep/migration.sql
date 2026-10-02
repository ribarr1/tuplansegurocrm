-- CreateEnum
CREATE TYPE "LeadWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');

-- AlterTable
ALTER TABLE "lead_integration_credentials" ADD COLUMN     "connectorSecrets" TEXT;

-- CreateTable
CREATE TABLE "lead_inbound_webhook_events" (
    "id" UUID NOT NULL,
    "source" "LeadSource" NOT NULL,
    "integrationCredentialId" UUID NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" "LeadWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdLeadId" UUID,

    CONSTRAINT "lead_inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_rate_limit_windows" (
    "id" UUID NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_rate_limit_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_inbound_webhook_events_status_receivedAt_idx" ON "lead_inbound_webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_inbound_webhook_events_source_integrationCredentialId__key" ON "lead_inbound_webhook_events"("source", "integrationCredentialId", "externalEventId");

-- CreateIndex
CREATE INDEX "lead_rate_limit_windows_windowStart_idx" ON "lead_rate_limit_windows"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "lead_rate_limit_windows_bucketKey_windowStart_key" ON "lead_rate_limit_windows"("bucketKey", "windowStart");

-- AddForeignKey
ALTER TABLE "lead_inbound_webhook_events" ADD CONSTRAINT "lead_inbound_webhook_events_integrationCredentialId_fkey" FOREIGN KEY ("integrationCredentialId") REFERENCES "lead_integration_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
