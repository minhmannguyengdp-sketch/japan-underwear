CREATE TABLE IF NOT EXISTS "japan_underwear"."product_color_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "color_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "source" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_color_variants_product_fk"
    FOREIGN KEY ("product_id")
    REFERENCES "japan_underwear"."products"("id")
    ON DELETE CASCADE,
  CONSTRAINT "product_color_variants_color_fk"
    FOREIGN KEY ("color_id")
    REFERENCES "japan_underwear"."product_colors"("id")
    ON DELETE CASCADE,
  CONSTRAINT "product_color_variants_variant_fk"
    FOREIGN KEY ("variant_id")
    REFERENCES "japan_underwear"."product_variants"("id")
    ON DELETE CASCADE,
  CONSTRAINT "product_color_variants_source_nonempty_chk"
    CHECK (btrim("source") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_color_variants_color_variant_uidx"
  ON "japan_underwear"."product_color_variants" ("color_id", "variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_color_variants_product_active_idx"
  ON "japan_underwear"."product_color_variants" ("product_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_color_variants_color_active_idx"
  ON "japan_underwear"."product_color_variants" ("color_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_color_variants_variant_active_idx"
  ON "japan_underwear"."product_color_variants" ("variant_id", "is_active");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."validate_product_color_variant_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  color_product_id uuid;
  variant_product_id uuid;
BEGIN
  SELECT "product_id" INTO color_product_id
  FROM "japan_underwear"."product_colors"
  WHERE "id" = NEW."color_id";

  SELECT "product_id" INTO variant_product_id
  FROM "japan_underwear"."product_variants"
  WHERE "id" = NEW."variant_id";

  IF color_product_id IS NULL OR variant_product_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'Không tìm thấy màu hoặc size/cup cho quan hệ bán hàng.';
  END IF;

  IF NEW."product_id" IS DISTINCT FROM color_product_id
     OR NEW."product_id" IS DISTINCT FROM variant_product_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'orderable_color_variant_selection_chk',
      MESSAGE = 'Màu và size/cup phải thuộc cùng sản phẩm.';
  END IF;

  NEW."updated_at" := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_color_variants_identity_trg"
  ON "japan_underwear"."product_color_variants";
--> statement-breakpoint
CREATE TRIGGER "product_color_variants_identity_trg"
BEFORE INSERT OR UPDATE
ON "japan_underwear"."product_color_variants"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_product_color_variant_identity"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."validate_orderable_color_variant_selection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "japan_underwear"."product_color_variants" AS availability
    JOIN "japan_underwear"."product_colors" AS color
      ON color."id" = availability."color_id"
    JOIN "japan_underwear"."product_variants" AS variant
      ON variant."id" = availability."variant_id"
    JOIN "japan_underwear"."products" AS product
      ON product."id" = availability."product_id"
    WHERE availability."color_id" = NEW."color_id"
      AND availability."variant_id" = NEW."product_variant_id"
      AND availability."is_active" = true
      AND color."is_active" = true
      AND variant."is_active" = true
      AND product."is_active" = true
      AND color."product_id" = product."id"
      AND variant."product_id" = product."id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'orderable_color_variant_selection_chk',
      MESSAGE = 'Màu và size/cup đã chọn không phải tổ hợp đang được bán.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cart_items_color_variant_selection_trg"
  ON "japan_underwear"."cart_items";
--> statement-breakpoint
CREATE TRIGGER "cart_items_color_variant_selection_trg"
BEFORE INSERT OR UPDATE
ON "japan_underwear"."cart_items"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_orderable_color_variant_selection"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "order_items_color_variant_selection_trg"
  ON "japan_underwear"."order_items";
--> statement-breakpoint
CREATE TRIGGER "order_items_color_variant_selection_trg"
BEFORE INSERT OR UPDATE OF "product_variant_id", "color_id"
ON "japan_underwear"."order_items"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_orderable_color_variant_selection"();
