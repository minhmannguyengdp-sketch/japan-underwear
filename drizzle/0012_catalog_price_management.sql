ALTER TABLE "japan_underwear"."products"
  ADD COLUMN IF NOT EXISTS "row_version" integer;
--> statement-breakpoint
UPDATE "japan_underwear"."products"
SET "row_version" = 1
WHERE "row_version" IS NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  ALTER COLUMN "row_version" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  ALTER COLUMN "row_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  DROP CONSTRAINT IF EXISTS "products_row_version_positive_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  ADD CONSTRAINT "products_row_version_positive_chk"
  CHECK ("row_version" >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  VALIDATE CONSTRAINT "products_row_version_positive_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  DROP CONSTRAINT IF EXISTS "products_base_price_nonnegative_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  ADD CONSTRAINT "products_base_price_nonnegative_chk"
  CHECK ("base_price" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."products"
  VALIDATE CONSTRAINT "products_base_price_nonnegative_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
UPDATE "japan_underwear"."product_colors"
SET "updated_at" = now()
WHERE "updated_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ADD COLUMN IF NOT EXISTS "row_version" integer;
--> statement-breakpoint
UPDATE "japan_underwear"."product_colors"
SET "row_version" = 1
WHERE "row_version" IS NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ALTER COLUMN "row_version" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ALTER COLUMN "row_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  DROP CONSTRAINT IF EXISTS "product_colors_row_version_positive_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  ADD CONSTRAINT "product_colors_row_version_positive_chk"
  CHECK ("row_version" >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors"
  VALIDATE CONSTRAINT "product_colors_row_version_positive_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD COLUMN IF NOT EXISTS "row_version" integer;
--> statement-breakpoint
UPDATE "japan_underwear"."product_variants"
SET "row_version" = 1
WHERE "row_version" IS NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ALTER COLUMN "row_version" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ALTER COLUMN "row_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  DROP CONSTRAINT IF EXISTS "product_variants_row_version_positive_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  ADD CONSTRAINT "product_variants_row_version_positive_chk"
  CHECK ("row_version" >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants"
  VALIDATE CONSTRAINT "product_variants_row_version_positive_chk";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."catalog_change_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "actor_label" text NOT NULL,
  "request_id" uuid,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "action" text NOT NULL DEFAULT 'updated',
  "before_snapshot" jsonb NOT NULL,
  "after_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalog_change_audit_actor_user_fk"
    FOREIGN KEY ("actor_user_id")
    REFERENCES "japan_underwear"."users"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "catalog_change_audit_product_fk"
    FOREIGN KEY ("product_id")
    REFERENCES "japan_underwear"."products"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "catalog_change_audit_actor_label_nonempty_chk"
    CHECK (btrim("actor_label") <> ''),
  CONSTRAINT "catalog_change_audit_entity_type_chk"
    CHECK ("entity_type" IN ('product', 'color', 'variant')),
  CONSTRAINT "catalog_change_audit_action_chk"
    CHECK ("action" = 'updated'),
  CONSTRAINT "catalog_change_audit_before_object_chk"
    CHECK (jsonb_typeof("before_snapshot") = 'object'),
  CONSTRAINT "catalog_change_audit_after_object_chk"
    CHECK (jsonb_typeof("after_snapshot") = 'object')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_change_audit_product_created_idx"
  ON "japan_underwear"."catalog_change_audit" ("product_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_change_audit_actor_created_idx"
  ON "japan_underwear"."catalog_change_audit" ("actor_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_change_audit_entity_created_idx"
  ON "japan_underwear"."catalog_change_audit" ("entity_type", "entity_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_change_audit_request_idx"
  ON "japan_underwear"."catalog_change_audit" ("request_id")
  WHERE "request_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."bump_catalog_row_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_business jsonb;
  new_business jsonb;
BEGIN
  old_business := to_jsonb(OLD) - 'row_version' - 'updated_at';
  new_business := to_jsonb(NEW) - 'row_version' - 'updated_at';

  IF new_business IS DISTINCT FROM old_business THEN
    IF OLD.row_version >= 2147483647 THEN
      RAISE EXCEPTION 'Catalog row version exhausted for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '22003';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.row_version := OLD.row_version;
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."record_catalog_change_audit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_setting text;
  request_setting text;
  audit_actor_user_id uuid;
  audit_request_id uuid;
  audit_actor_label text;
  audit_entity_type text;
  audit_product_id uuid;
BEGIN
  IF NEW.row_version = OLD.row_version THEN
    RETURN NEW;
  END IF;

  actor_setting := NULLIF(
    btrim(current_setting('japan_underwear.catalog_actor_user_id', true)),
    ''
  );
  request_setting := NULLIF(
    btrim(current_setting('japan_underwear.catalog_request_id', true)),
    ''
  );
  audit_actor_label := COALESCE(
    NULLIF(btrim(current_setting('japan_underwear.catalog_actor_label', true)), ''),
    current_user || ':direct-database-update'
  );

  IF actor_setting IS NOT NULL THEN
    audit_actor_user_id := actor_setting::uuid;
  END IF;
  IF request_setting IS NOT NULL THEN
    audit_request_id := request_setting::uuid;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'products' THEN
      audit_entity_type := 'product';
      audit_product_id := NEW.id;
    WHEN 'product_colors' THEN
      audit_entity_type := 'color';
      audit_product_id := NEW.product_id;
    WHEN 'product_variants' THEN
      audit_entity_type := 'variant';
      audit_product_id := NEW.product_id;
    ELSE
      RAISE EXCEPTION 'Unsupported catalog audit table: %', TG_TABLE_NAME
        USING ERRCODE = '0A000';
  END CASE;

  INSERT INTO "japan_underwear"."catalog_change_audit" (
    actor_user_id,
    actor_label,
    request_id,
    entity_type,
    entity_id,
    product_id,
    action,
    before_snapshot,
    after_snapshot
  )
  VALUES (
    audit_actor_user_id,
    audit_actor_label,
    audit_request_id,
    audit_entity_type,
    NEW.id,
    audit_product_id,
    'updated',
    to_jsonb(OLD),
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "products_catalog_version_trg"
  ON "japan_underwear"."products";
--> statement-breakpoint
CREATE TRIGGER "products_catalog_version_trg"
BEFORE UPDATE
ON "japan_underwear"."products"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."bump_catalog_row_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_colors_catalog_version_trg"
  ON "japan_underwear"."product_colors";
--> statement-breakpoint
CREATE TRIGGER "product_colors_catalog_version_trg"
BEFORE UPDATE
ON "japan_underwear"."product_colors"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."bump_catalog_row_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_variants_catalog_version_trg"
  ON "japan_underwear"."product_variants";
--> statement-breakpoint
CREATE TRIGGER "product_variants_catalog_version_trg"
BEFORE UPDATE
ON "japan_underwear"."product_variants"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."bump_catalog_row_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "products_catalog_audit_trg"
  ON "japan_underwear"."products";
--> statement-breakpoint
CREATE TRIGGER "products_catalog_audit_trg"
AFTER UPDATE
ON "japan_underwear"."products"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."record_catalog_change_audit"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_colors_catalog_audit_trg"
  ON "japan_underwear"."product_colors";
--> statement-breakpoint
CREATE TRIGGER "product_colors_catalog_audit_trg"
AFTER UPDATE
ON "japan_underwear"."product_colors"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."record_catalog_change_audit"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_variants_catalog_audit_trg"
  ON "japan_underwear"."product_variants";
--> statement-breakpoint
CREATE TRIGGER "product_variants_catalog_audit_trg"
AFTER UPDATE
ON "japan_underwear"."product_variants"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."record_catalog_change_audit"();
