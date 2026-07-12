DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "japan_underwear"."products"
    WHERE "category_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot require products.category_id while null rows exist.';
  END IF;
END
$$;--> statement-breakpoint

UPDATE "japan_underwear"."products" AS product
SET
  "slug" = identity."brand_slug" || '-' || identity."category_slug" || '-' || product."model_code",
  "source_product_id" = 'local:' || identity."brand_slug" || ':' || identity."category_slug" || ':' || product."model_code",
  "updated_at" = now()
FROM (
  SELECT
    product_identity."id",
    brand."slug" AS "brand_slug",
    category."slug" AS "category_slug"
  FROM "japan_underwear"."products" AS product_identity
  JOIN "japan_underwear"."brands" AS brand
    ON brand."id" = product_identity."brand_id"
  JOIN "japan_underwear"."categories" AS category
    ON category."id" = product_identity."category_id"
) AS identity
WHERE identity."id" = product."id";--> statement-breakpoint

ALTER TABLE "japan_underwear"."products"
  ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "japan_underwear"."products"
  DROP CONSTRAINT IF EXISTS "products_category_id_categories_id_fk";--> statement-breakpoint

ALTER TABLE "japan_underwear"."products"
  ADD CONSTRAINT "products_category_id_categories_id_fk"
  FOREIGN KEY ("category_id")
  REFERENCES "japan_underwear"."categories"("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;--> statement-breakpoint

DROP INDEX IF EXISTS "japan_underwear"."products_brand_model_uidx";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "products_brand_category_model_uidx"
  ON "japan_underwear"."products" USING btree
  ("brand_id", "category_id", "model_code");
