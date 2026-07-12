CREATE TABLE IF NOT EXISTS "japan_underwear"."carts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" uuid DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "converted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "carts_status_chk" CHECK ("status" IN ('active', 'converted', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carts_token_uidx"
  ON "japan_underwear"."carts" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_status_updated_idx"
  ON "japan_underwear"."carts" USING btree ("status", "updated_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "japan_underwear"."cart_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_id" uuid NOT NULL,
  "product_variant_id" uuid NOT NULL,
  "color_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_snapshot" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cart_items_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 999),
  CONSTRAINT "cart_items_price_chk" CHECK ("unit_price_snapshot" >= 0),
  CONSTRAINT "cart_items_cart_id_carts_id_fk"
    FOREIGN KEY ("cart_id") REFERENCES "japan_underwear"."carts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cart_items_product_variant_id_product_variants_id_fk"
    FOREIGN KEY ("product_variant_id") REFERENCES "japan_underwear"."product_variants"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "cart_items_color_id_product_colors_id_fk"
    FOREIGN KEY ("color_id") REFERENCES "japan_underwear"."product_colors"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_variant_color_uidx"
  ON "japan_underwear"."cart_items" USING btree ("cart_id", "product_variant_id", "color_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_items_cart_idx"
  ON "japan_underwear"."cart_items" USING btree ("cart_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_items_variant_idx"
  ON "japan_underwear"."cart_items" USING btree ("product_variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_items_color_idx"
  ON "japan_underwear"."cart_items" USING btree ("color_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "japan_underwear"."orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_code" text NOT NULL,
  "source_cart_id" uuid NOT NULL,
  "status" text DEFAULT 'submitted' NOT NULL,
  "customer_name" text NOT NULL,
  "customer_phone" text NOT NULL,
  "delivery_address" text,
  "note" text,
  "subtotal" integer NOT NULL,
  "currency" text DEFAULT 'VND' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "orders_status_chk" CHECK ("status" IN ('submitted', 'confirmed', 'cancelled')),
  CONSTRAINT "orders_customer_name_nonempty_chk" CHECK (btrim("customer_name") <> ''),
  CONSTRAINT "orders_customer_phone_nonempty_chk" CHECK (btrim("customer_phone") <> ''),
  CONSTRAINT "orders_subtotal_chk" CHECK ("subtotal" >= 0),
  CONSTRAINT "orders_source_cart_id_carts_id_fk"
    FOREIGN KEY ("source_cart_id") REFERENCES "japan_underwear"."carts"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_order_code_uidx"
  ON "japan_underwear"."orders" USING btree ("order_code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_source_cart_uidx"
  ON "japan_underwear"."orders" USING btree ("source_cart_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_created_idx"
  ON "japan_underwear"."orders" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_customer_phone_idx"
  ON "japan_underwear"."orders" USING btree ("customer_phone");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "japan_underwear"."order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "product_variant_id" uuid NOT NULL,
  "color_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" integer NOT NULL,
  "line_total" integer NOT NULL,
  "product_code_snapshot" text NOT NULL,
  "product_name_snapshot" text NOT NULL,
  "color_code_snapshot" text NOT NULL,
  "color_name_snapshot" text NOT NULL,
  "size_code_snapshot" text NOT NULL,
  "cup_code_snapshot" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_items_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 999),
  CONSTRAINT "order_items_unit_price_chk" CHECK ("unit_price" >= 0),
  CONSTRAINT "order_items_line_total_chk" CHECK ("line_total" = "unit_price" * "quantity"),
  CONSTRAINT "order_items_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "japan_underwear"."orders"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_items_product_variant_id_product_variants_id_fk"
    FOREIGN KEY ("product_variant_id") REFERENCES "japan_underwear"."product_variants"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "order_items_color_id_product_colors_id_fk"
    FOREIGN KEY ("color_id") REFERENCES "japan_underwear"."product_colors"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_items_order_variant_color_uidx"
  ON "japan_underwear"."order_items" USING btree ("order_id", "product_variant_id", "color_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_idx"
  ON "japan_underwear"."order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_variant_idx"
  ON "japan_underwear"."order_items" USING btree ("product_variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_color_idx"
  ON "japan_underwear"."order_items" USING btree ("color_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "japan_underwear"."validate_order_selection_same_product"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  variant_product_id uuid;
  color_product_id uuid;
  variant_active boolean;
  color_active boolean;
  product_active boolean;
BEGIN
  SELECT variant.product_id, variant.is_active, product.is_active
    INTO variant_product_id, variant_active, product_active
  FROM "japan_underwear"."product_variants" AS variant
  JOIN "japan_underwear"."products" AS product
    ON product.id = variant.product_id
  WHERE variant.id = NEW.product_variant_id;

  SELECT color.product_id, color.is_active
    INTO color_product_id, color_active
  FROM "japan_underwear"."product_colors" AS color
  WHERE color.id = NEW.color_id;

  IF variant_product_id IS NULL OR color_product_id IS NULL THEN
    RAISE EXCEPTION 'Unknown product variant or color.' USING ERRCODE = '23503';
  END IF;

  IF variant_product_id <> color_product_id THEN
    RAISE EXCEPTION 'product_variant_id and color_id must belong to the same product.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'cart_items' AND (NOT variant_active OR NOT color_active OR NOT product_active) THEN
    RAISE EXCEPTION 'Inactive product, variant, or color cannot be added to an active cart.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cart_items_selection_same_product_trg"
  ON "japan_underwear"."cart_items";
--> statement-breakpoint
CREATE TRIGGER "cart_items_selection_same_product_trg"
BEFORE INSERT OR UPDATE OF "product_variant_id", "color_id"
ON "japan_underwear"."cart_items"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_order_selection_same_product"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "order_items_selection_same_product_trg"
  ON "japan_underwear"."order_items";
--> statement-breakpoint
CREATE TRIGGER "order_items_selection_same_product_trg"
BEFORE INSERT OR UPDATE OF "product_variant_id", "color_id"
ON "japan_underwear"."order_items"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_order_selection_same_product"();
