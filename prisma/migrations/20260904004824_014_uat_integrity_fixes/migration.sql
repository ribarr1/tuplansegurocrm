-- Fase 022 (Hallazgo #5 de UAT): prevenir productos duplicados.
-- Identidad de producto V1: carrierId + nombre normalizado (trim,
-- minúsculas, espacios redundantes colapsados) + policyType + planYear.

-- AlterTable: nullable primero para poder rellenar antes de exigir NOT NULL.
ALTER TABLE "products" ADD COLUMN "nameNormalized" TEXT;

-- Rellena desde el nombre ya existente.
UPDATE "products" SET "nameNormalized" = lower(regexp_replace(trim(name), '\s+', ' ', 'g'));

-- La base dev actual ya tiene productos duplicados reales (mismo
-- carrier/nombre/tipo/año) creados antes de esta protección — ver
-- docs/DECISIONS.md. Nunca se borran (podrían tener Policy/
-- CommissionRule relacionadas); se desambigua el nameNormalized de las
-- filas adicionales (todas menos la más antigua de cada grupo,
-- ordenadas por createdAt) solo para poder crear el índice único sin
-- perder ninguna fila. La base de datos dev se reinicia por completo
-- al final de esta fase (Parte K), así que esto es una medida
-- transitoria sobre datos de prueba, no una migración de datos real.
WITH ranked AS (
  SELECT id, "nameNormalized",
         ROW_NUMBER() OVER (
           PARTITION BY "carrierId", "nameNormalized", "policyType", COALESCE("planYear", -1)
           ORDER BY "createdAt" ASC
         ) AS rn
  FROM "products"
)
UPDATE "products" p
SET "nameNormalized" = p."nameNormalized" || '-dup-' || SUBSTRING(p.id::text, 1, 8)
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- Ahora sí, requerido. DEFAULT '' es solo un placeholder para que
-- Prisma Client marque el campo como opcional en `create()` — el
-- trigger de más abajo SIEMPRE recalcula el valor real a partir de
-- `name`, nunca se depende de este default.
ALTER TABLE "products" ALTER COLUMN "nameNormalized" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "nameNormalized" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "products_carrierId_nameNormalized_policyType_planYear_key" ON "products"("carrierId", "nameNormalized", "policyType", "planYear");

-- Trigger: mantiene nameNormalized SIEMPRE sincronizado con name, para
-- cualquier INSERT/UPDATE sin importar qué código escriba la fila
-- (el servicio de aplicación, scripts de seed, el importador legacy,
-- fixtures de tests) — así ningún call-site necesita saber que este
-- campo derivado existe. products.service.ts sigue haciendo su propio
-- chequeo previo (con mensaje claro) ANTES de intentar el INSERT/UPDATE;
-- este trigger + el índice único de arriba son la protección real que
-- nunca puede saltarse, incluso si algún código nuevo escribe la tabla
-- directamente sin pasar por el servicio.
CREATE OR REPLACE FUNCTION products_set_name_normalized() RETURNS trigger AS $$
BEGIN
  NEW."nameNormalized" := lower(regexp_replace(trim(NEW.name), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_name_normalized_trigger ON "products";
CREATE TRIGGER products_name_normalized_trigger
  BEFORE INSERT OR UPDATE OF name ON "products"
  FOR EACH ROW
  EXECUTE FUNCTION products_set_name_normalized();
