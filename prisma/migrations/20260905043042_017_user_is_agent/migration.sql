-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAgent" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (Fase 025.4, UAT-03/07): todo usuario con role=AGENT
-- siempre implicó ser agente de la agencia -- se marca isAgent=true
-- automáticamente. ADMIN y ASSISTANT NUNCA se tocan aquí (isAgent
-- queda en su default false) -- asignar isAgent a un ADMIN específico
-- es una decisión de negocio explícita, no una regla derivable de su
-- rol, y se hace por separado (ver docs/DECISIONS.md).
UPDATE "users" SET "isAgent" = true WHERE role = 'AGENT';
