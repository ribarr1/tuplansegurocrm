-- CORRECCIÓN (activación de usuarios): `activatedAt` distingue una
-- cuenta que YA estableció su propia contraseña (por invitación) de
-- una que sigue "pendiente de activación". Los usuarios YA EXISTENTES
-- en esta base ya tienen credenciales funcionando (fueron creados con
-- el flujo anterior de contraseña temporal, o vía create-admin.ts) —
-- nunca deben aparecer como "pendientes" retroactivamente. Se
-- backfillea con su propia `createdAt` como aproximación razonable
-- ("ya estaban activos desde que se crearon"); usuarios NUEVOS creados
-- a partir de esta migración se insertan explícitamente con
-- activatedAt=null hasta que completen la invitación.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activatedAt" TIMESTAMP(3);

UPDATE "users" SET "activatedAt" = "createdAt" WHERE "activatedAt" IS NULL;
