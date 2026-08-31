-- AlterEnum
-- Elimina PolicyStatus.RENEWED: era un estado derivado (renewedInto != null),
-- no un hecho propio de la póliza. La base está vacía, por lo que el cast
-- USING no descarta ningún dato real.
BEGIN;
CREATE TYPE "PolicyStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED');
ALTER TABLE "public"."policies" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "policies" ALTER COLUMN "status" TYPE "PolicyStatus_new" USING ("status"::text::"PolicyStatus_new");
ALTER TYPE "PolicyStatus" RENAME TO "PolicyStatus_old";
ALTER TYPE "PolicyStatus_new" RENAME TO "PolicyStatus";
DROP TYPE "public"."PolicyStatus_old";
ALTER TABLE "policies" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
-- effectiveDate nullable: una Policy PENDING puede existir antes de conocer
-- su fecha efectiva definitiva. Requerida cuando status = ACTIVE, regla de
-- aplicación, no de DB.
ALTER TABLE "policies" ALTER COLUMN "effectiveDate" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "household_members_householdId_idx" ON "household_members"("householdId");

-- CreateIndex
CREATE INDEX "people_assignedAgentId_idx" ON "people"("assignedAgentId");

-- CreateIndex
CREATE INDEX "policies_householdId_idx" ON "policies"("householdId");

-- CheckConstraint
-- Impide que una Policy se marque como renovación de sí misma. Ciclos de
-- más de un nivel (A -> B -> A) no se validan en DB, quedan a cargo de la
-- aplicación/servicio.
ALTER TABLE "policies" ADD CONSTRAINT "policies_previousPolicyId_not_self_check" CHECK ("id" <> "previousPolicyId");

-- CreateIndex (partial unique)
-- Como máximo un PolicyMember con role = PRIMARY por Policy. Que ese
-- PRIMARY coincida con Policy.holderId se valida en aplicación (requeriría
-- trigger cross-tabla, desproporcionado para esta fase).
CREATE UNIQUE INDEX "policy_members_policyId_primary_key" ON "policy_members"("policyId") WHERE "role" = 'PRIMARY';

-- CheckConstraint
-- Una Note debe estar asociada a Person y/o Policy; nunca a ninguna de las
-- dos. No aplica a Task (las tareas generales internas sí pueden carecer
-- de ambas).
ALTER TABLE "notes" ADD CONSTRAINT "notes_person_or_policy_check" CHECK ("personId" IS NOT NULL OR "policyId" IS NOT NULL);

-- CheckConstraint
-- Coherencia de BirthdayGreeting: SENT siempre tiene channel y sentAt;
-- cualquier otro status nunca tiene sentAt (PENDING/SKIPPED no tienen
-- fecha de envío real).
ALTER TABLE "birthday_greetings" ADD CONSTRAINT "birthday_greetings_sent_requires_channel_and_sentat_check" CHECK ("status" <> 'SENT' OR ("channel" IS NOT NULL AND "sentAt" IS NOT NULL));
ALTER TABLE "birthday_greetings" ADD CONSTRAINT "birthday_greetings_sentat_only_when_sent_check" CHECK ("status" = 'SENT' OR "sentAt" IS NULL);
