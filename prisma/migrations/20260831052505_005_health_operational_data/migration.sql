-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('PCP', 'SPECIALIST', 'OTHER');

-- CreateTable
CREATE TABLE "person_providers" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "type" "ProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "organization" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_medications" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_medications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_providers_personId_idx" ON "person_providers"("personId");

-- CreateIndex
CREATE INDEX "person_medications_personId_idx" ON "person_medications"("personId");

-- CreateIndex
CREATE INDEX "person_medications_personId_isActive_idx" ON "person_medications"("personId", "isActive");

-- AddForeignKey
ALTER TABLE "person_providers" ADD CONSTRAINT "person_providers_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_medications" ADD CONSTRAINT "person_medications_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
