-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "CardBrand" AS ENUM ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHECKING', 'SAVINGS');

-- CreateEnum
CREATE TYPE "PaymentConsentUse" AS ENUM ('AUTOPAY', 'PAYMENT_ASSISTANCE', 'BOTH');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "policyId" UUID,
    "type" "PaymentMethodType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cardholderName" TEXT,
    "cardNumberEncrypted" TEXT,
    "cardLast4" VARCHAR(4),
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "cardBrand" "CardBrand",
    "bankAccountHolderName" TEXT,
    "bankName" TEXT,
    "routingNumberEncrypted" TEXT,
    "accountNumberEncrypted" TEXT,
    "accountLast4" VARCHAR(4),
    "bankAccountType" "BankAccountType",
    "billingAddressLine1" TEXT,
    "billingAddressLine2" TEXT,
    "billingCity" TEXT,
    "billingState" VARCHAR(2),
    "billingZipCode" TEXT,
    "commentEncrypted" TEXT,
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "consentUse" "PaymentConsentUse",
    "consentByUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_methods_personId_idx" ON "payment_methods"("personId");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_consentByUserId_fkey" FOREIGN KEY ("consentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
