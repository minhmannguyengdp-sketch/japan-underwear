ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "customer_user_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
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
CREATE INDEX IF NOT EXISTS "orders_customer_user_created_idx"
  ON "japan_underwear"."orders" USING btree ("customer_user_id", "created_at" DESC, "id" DESC)
  WHERE "customer_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."protect_order_customer_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.customer_user_id IS NOT NULL
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
BEFORE UPDATE OF "customer_user_id"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."protect_order_customer_owner"();
