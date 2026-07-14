ALTER TABLE "japan_underwear"."carts"
  ADD COLUMN IF NOT EXISTS "customer_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "customer_user_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.carts'::regclass
      AND conname = 'carts_customer_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "japan_underwear"."carts"
      ADD CONSTRAINT "carts_customer_user_id_users_id_fk"
      FOREIGN KEY ("customer_user_id")
      REFERENCES "japan_underwear"."users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.orders'::regclass
      AND conname = 'orders_customer_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_customer_user_id_users_id_fk"
      FOREIGN KEY ("customer_user_id")
      REFERENCES "japan_underwear"."users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_customer_user_status_idx"
  ON "japan_underwear"."carts" USING btree ("customer_user_id", "status", "updated_at" DESC)
  WHERE "customer_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_customer_user_created_idx"
  ON "japan_underwear"."orders" USING btree ("customer_user_id", "created_at" DESC, "id" DESC)
  WHERE "customer_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."protect_cart_customer_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.customer_user_id IS NOT NULL
     AND NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id THEN
    RAISE EXCEPTION 'Cart customer owner cannot be changed once assigned.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "carts_customer_owner_guard_trg"
  ON "japan_underwear"."carts";
--> statement-breakpoint
CREATE TRIGGER "carts_customer_owner_guard_trg"
BEFORE UPDATE OF "customer_user_id"
ON "japan_underwear"."carts"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."protect_cart_customer_owner"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."inherit_and_protect_order_customer_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cart_customer_user_id uuid;
BEGIN
  SELECT cart.customer_user_id
    INTO cart_customer_user_id
  FROM "japan_underwear"."carts" AS cart
  WHERE cart.id = NEW.source_cart_id;

  IF cart_customer_user_id IS NOT NULL THEN
    IF NEW.customer_user_id IS NULL THEN
      NEW.customer_user_id := cart_customer_user_id;
    ELSIF NEW.customer_user_id <> cart_customer_user_id THEN
      RAISE EXCEPTION 'Order customer owner must match the source cart owner.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.customer_user_id IS NOT NULL
     AND NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id THEN
    RAISE EXCEPTION 'Order customer owner cannot be changed once assigned.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_customer_owner_guard_trg"
  ON "japan_underwear"."orders";
--> statement-breakpoint
CREATE TRIGGER "orders_customer_owner_guard_trg"
BEFORE INSERT OR UPDATE OF "customer_user_id", "source_cart_id"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."inherit_and_protect_order_customer_owner"();
