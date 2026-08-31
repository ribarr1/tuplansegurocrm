-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "BirthdayGreetingStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BirthdayGreetingChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'OTHER');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "personId" UUID,
    "policyId" UUID,
    "assignedToId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "personId" UUID,
    "policyId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_greetings" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "BirthdayGreetingStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "BirthdayGreetingChannel",
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birthday_greetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_assignedToId_status_dueAt_idx" ON "tasks"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_personId_idx" ON "tasks"("personId");

-- CreateIndex
CREATE INDEX "tasks_policyId_idx" ON "tasks"("policyId");

-- CreateIndex
CREATE INDEX "notes_personId_idx" ON "notes"("personId");

-- CreateIndex
CREATE INDEX "notes_policyId_idx" ON "notes"("policyId");

-- CreateIndex
CREATE INDEX "birthday_greetings_year_status_idx" ON "birthday_greetings"("year", "status");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_greetings_personId_year_key" ON "birthday_greetings"("personId", "year");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_greetings" ADD CONSTRAINT "birthday_greetings_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
