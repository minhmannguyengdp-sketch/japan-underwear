DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM japan_underwear.product_variants LIMIT 1) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'product_variants is not empty',
      DETAIL = 'Migration 0003 refuses to guess how legacy color-linked variants map to product + size + cup.',
      HINT = 'Audit and clear/migrate legacy variant rows explicitly before retrying.';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX IF EXISTS "japan_underwear"."product_variants_product_color_size_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "japan_underwear"."product_variants_color_idx";--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  DROP CONSTRAINT IF EXISTS "product_variants_color_id_product_colors_id_fk";--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  DROP COLUMN IF EXISTS "color_id";--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD COLUMN IF NOT EXISTS "cup_code" text;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ADD CONSTRAINT "product_colors_code_nonempty_chk"
  CHECK (btrim("code") <> '');--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ADD CONSTRAINT "product_colors_name_nonempty_chk"
  CHECK (btrim("name") <> '');--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD CONSTRAINT "product_variants_size_nonempty_chk"
  CHECK (btrim("size_code") <> '');--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD CONSTRAINT "product_variants_cup_format_chk"
  CHECK ("cup_code" IS NULL OR "cup_code" ~ '^[A-Z]+$');--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD CONSTRAINT "product_variants_price_override_nonnegative_chk"
  CHECK ("price_override" IS NULL OR "price_override" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_size_cup_uidx"
  ON "japan_underwear"."product_variants" USING btree ("product_id", "size_code", "cup_code")
  WHERE "cup_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_size_no_cup_uidx"
  ON "japan_underwear"."product_variants" USING btree ("product_id", "size_code")
  WHERE "cup_code" IS NULL;--> statement-breakpoint
