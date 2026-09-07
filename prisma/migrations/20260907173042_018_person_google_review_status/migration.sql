-- CreateEnum
CREATE TYPE "GoogleReviewStatus" AS ENUM ('PENDING_REQUEST', 'REQUESTED', 'PUBLISHED', 'DO_NOT_REQUEST');

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "googleReviewStatus" "GoogleReviewStatus" NOT NULL DEFAULT 'PENDING_REQUEST',
ADD COLUMN     "reviewPublishedAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reviewStatusUpdatedById" UUID;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_reviewStatusUpdatedById_fkey" FOREIGN KEY ("reviewStatusUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
