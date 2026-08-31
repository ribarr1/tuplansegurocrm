-- Corrección: la migración 007_auth_foundation se generó con la CLI
-- deprecada @better-auth/cli@1.4.22, cuyo esquema no incluye el campo
-- "issuer" que sí requiere el runtime instalado de Better Auth (1.7.2)
-- para diferenciar cuentas de credenciales. Detectado al probar el
-- bootstrap del primer ADMIN (auth.api.signUpEmail falló con
-- "Unknown argument `issuer`"). Tabla "account" estaba vacía en el
-- momento de aplicar este cambio: sin riesgo de datos.

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "issuer" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
