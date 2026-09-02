-- CreateEnum
CREATE TYPE "ImmigrationCategory" AS ENUM ('US_CITIZEN', 'LAWFUL_PERMANENT_RESIDENT', 'EMPLOYMENT_AUTHORIZATION', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImmigrationDocumentType" AS ENUM ('PERMANENT_RESIDENT_CARD', 'EMPLOYMENT_AUTHORIZATION_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "person_sensitive_identities" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "immigrationCategory" "ImmigrationCategory" NOT NULL DEFAULT 'UNKNOWN',
    "ssnEncrypted" TEXT,
    "ssnLast4" VARCHAR(4),
    "uscisNumberEncrypted" TEXT,
    "uscisNumberLast4" VARCHAR(4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_sensitive_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_immigration_documents" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "documentType" "ImmigrationDocumentType" NOT NULL,
    "documentNumberEncrypted" TEXT,
    "documentNumberLast4" VARCHAR(4),
    "issuedDate" DATE,
    "expirationDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_immigration_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_sensitive_identities_personId_key" ON "person_sensitive_identities"("personId");

-- CreateIndex
CREATE INDEX "person_immigration_documents_personId_idx" ON "person_immigration_documents"("personId");

-- CreateIndex
CREATE INDEX "person_immigration_documents_personId_isActive_idx" ON "person_immigration_documents"("personId", "isActive");

-- AddForeignKey
ALTER TABLE "person_sensitive_identities" ADD CONSTRAINT "person_sensitive_identities_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_immigration_documents" ADD CONSTRAINT "person_immigration_documents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

