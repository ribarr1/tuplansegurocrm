-- Fase 025: PaymentManagementMode, PolicyBusinessSource, licencias de
-- agente, contratos carrier/agente, vault de credenciales (agente y
-- cliente), y correcciones de datos de UAT. Nunca modifica migraciones
-- históricas.

-- CreateEnum
CREATE TYPE "AgentLicenseStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentContractStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ClientPortalType" AS ENUM ('CARRIER', 'MARKETPLACE', 'STATE_EXCHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentManagementMode" AS ENUM ('AUTOPAY', 'ASSISTED', 'CLIENT_MANAGED');

-- CreateEnum
CREATE TYPE "PolicyBusinessSource" AS ENUM ('OWN', 'REFERRAL', 'UNKNOWN');

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "businessSource" "PolicyBusinessSource" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "paymentManagementMode" "PaymentManagementMode" NOT NULL DEFAULT 'CLIENT_MANAGED';

-- CreateTable
CREATE TABLE "agent_licenses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "status" "AgentLicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "licenseNumber" TEXT,
    "effectiveDate" DATE,
    "expirationDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_carrier_contracts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "policyType" "PolicyType" NOT NULL,
    "status" "AgentContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveDate" DATE,
    "terminationDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_carrier_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_portal_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "carrierId" UUID,
    "portalName" TEXT NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "usernameEncrypted" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "notesEncrypted" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_portal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_credentials" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "carrierId" UUID,
    "policyId" UUID,
    "portalType" "ClientPortalType" NOT NULL,
    "portalName" TEXT NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "usernameEncrypted" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_portal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_licenses_userId_idx" ON "agent_licenses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_licenses_userId_state_key" ON "agent_licenses"("userId", "state");

-- CreateIndex
CREATE INDEX "agent_carrier_contracts_userId_idx" ON "agent_carrier_contracts"("userId");

-- CreateIndex
CREATE INDEX "agent_carrier_contracts_carrierId_state_policyType_idx" ON "agent_carrier_contracts"("carrierId", "state", "policyType");

-- CreateIndex
CREATE UNIQUE INDEX "agent_carrier_contracts_userId_carrierId_state_policyType_key" ON "agent_carrier_contracts"("userId", "carrierId", "state", "policyType");

-- CreateIndex
CREATE INDEX "agent_portal_credentials_userId_idx" ON "agent_portal_credentials"("userId");

-- CreateIndex
CREATE INDEX "client_portal_credentials_personId_idx" ON "client_portal_credentials"("personId");

-- AddForeignKey
ALTER TABLE "agent_licenses" ADD CONSTRAINT "agent_licenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_carrier_contracts" ADD CONSTRAINT "agent_carrier_contracts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_carrier_contracts" ADD CONSTRAINT "agent_carrier_contracts_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_portal_credentials" ADD CONSTRAINT "agent_portal_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_portal_credentials" ADD CONSTRAINT "agent_portal_credentials_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_credentials" ADD CONSTRAINT "client_portal_credentials_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_credentials" ADD CONSTRAINT "client_portal_credentials_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_credentials" ADD CONSTRAINT "client_portal_credentials_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Backfill de datos — Fase 025, Parte C (Hallazgo #3)
-- ============================================================
-- Mapeo: autopay=true -> AUTOPAY (incluso si needsPaymentAssistance
-- también es true — ver docs/DECISIONS.md para el análisis de los 2
-- casos reales encontrados en DEV: ambos fueron ediciones reales y
-- deliberadas del usuario real vía la UI, POSTERIORES a la
-- importación que ya había fijado needsPaymentAssistance=true; el
-- AuditEvent confirma que "marcar Autopay" fue la acción explícita más
-- reciente, así que se prioriza sobre la bandera de asistencia
-- heredada del import). Sin autopay, needsPaymentAssistance=true ->
-- ASSISTED. Ninguna de las dos -> CLIENT_MANAGED.
UPDATE "policies"
SET "paymentManagementMode" = CASE
  WHEN "autopay" = true THEN 'AUTOPAY'::"PaymentManagementMode"
  WHEN "needsPaymentAssistance" = true THEN 'ASSISTED'::"PaymentManagementMode"
  ELSE 'CLIENT_MANAGED'::"PaymentManagementMode"
END;

-- ============================================================
-- Corrección de Fase 024 — Parte A (Hallazgo #1)
-- ============================================================
-- Las pólizas HEALTH planYear=2025 se normalizaron a CANCELLED en
-- Fase 024; la regla correcta es EXPIRED (llegaron al final natural de
-- su año de cobertura, nunca fueron canceladas realmente). Acotado a
-- HEALTH 2025 actualmente CANCELLED — nunca toca una cancelación real
-- de otro año/tipo. terminationDate ya quedó en 2025-12-31 desde Fase
-- 024, se conserva tal cual.
UPDATE "policies" p
SET "status" = 'EXPIRED'
FROM "products" prod
WHERE p."productId" = prod."id"
  AND prod."policyType" = 'HEALTH'
  AND prod."planYear" = 2025
  AND p."status" = 'CANCELLED';

-- ============================================================
-- Limpieza de datos de prueba (Fase 025) — Parte F
-- ============================================================
-- Se detectó 1 Product ("Dental" bajo el carrier real CIGNA) con 2
-- CommissionRule ACTIVE simultáneas a nivel de producto — investigado
-- vía AuditEvent: ambas filas provienen de un actor de prueba
-- (actorType USER, actorUserId NULL porque el User de prueba que las
-- creó ya fue borrado por la limpieza normal de sus propios tests),
-- nunca del usuario real ni de datos importados. Se desactiva la más
-- antigua para dejar como máximo 1 activa, condición previa
-- obligatoria para el índice único parcial de abajo.
UPDATE "commission_rules"
SET "isActive" = false
WHERE "id" = (
  SELECT "id" FROM "commission_rules"
  WHERE "policyId" IS NULL AND "isActive" = true
  GROUP BY "id", "productId", "createdAt"
  HAVING "productId" IN (
    SELECT "productId" FROM "commission_rules"
    WHERE "policyId" IS NULL AND "isActive" = true
    GROUP BY "productId"
    HAVING COUNT(*) > 1
  )
  ORDER BY "createdAt" ASC
  LIMIT 1
);

-- ============================================================
-- Máximo 1 CommissionRule ACTIVE por Product (nivel producto) y por
-- Policy (override) — Fase 025, Parte F. Índice único parcial: nunca
-- expresable en schema.prisma (sin soporte de WHERE en @@unique),
-- mismo criterio que el trigger de products.nameNormalized (Fase 022).
-- ============================================================
CREATE UNIQUE INDEX "commission_rules_one_active_per_product"
  ON "commission_rules" ("productId")
  WHERE "policyId" IS NULL AND "isActive" = true;

CREATE UNIQUE INDEX "commission_rules_one_active_override_per_policy"
  ON "commission_rules" ("policyId")
  WHERE "policyId" IS NOT NULL AND "isActive" = true;
