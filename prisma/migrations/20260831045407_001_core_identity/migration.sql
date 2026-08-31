-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('PROSPECT', 'CLIENT', 'FORMER_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HouseholdMemberRole" AS ENUM ('HEAD', 'SPOUSE', 'CHILD', 'DEPENDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('HEALTH', 'LIFE', 'SUPPLEMENTAL', 'DENTAL', 'FINAL_EXPENSE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "secondLastName" TEXT,
    "preferredName" TEXT,
    "dateOfBirth" DATE,
    "email" TEXT,
    "phone" TEXT,
    "contactStatus" "ContactStatus" NOT NULL DEFAULT 'PROSPECT',
    "source" TEXT,
    "assignedAgentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "role" "HouseholdMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carriers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "policyType" "PolicyType" NOT NULL,
    "planYear" INTEGER,
    "externalCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "people_lastName_idx" ON "people"("lastName");

-- CreateIndex
CREATE INDEX "people_phone_idx" ON "people"("phone");

-- CreateIndex
CREATE INDEX "people_email_idx" ON "people"("email");

-- CreateIndex
CREATE UNIQUE INDEX "household_members_personId_householdId_key" ON "household_members"("personId", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "carriers_name_key" ON "carriers"("name");

-- CreateIndex
CREATE INDEX "products_carrierId_policyType_planYear_idx" ON "products"("carrierId", "policyType", "planYear");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
