ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "order_source" text;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "manual_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;
--> statement-breakpoint
UPDATE "japan_underwear"."orders"
SET "order_source" = CASE
  WHEN "customer_user_id" IS NOT NULL AND "client_request_id" IS NOT NULL
    THEN 'customer_checkout'
  ELSE 'legacy_cart'
END
WHERE "order_source" IS NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ALTER COLUMN "order_source" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ALTER COLUMN "order_source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ALTER COLUMN "source_cart_id" DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.orders'::regclass
      AND conname = 'orders_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id")
      REFERENCES "japan_underwear"."users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."derive_order_creation_source"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_source IS NULL OR btrim(NEW.order_source) = '' THEN
    NEW.order_source := CASE
      WHEN NEW.manual_request_id IS NOT NULL AND NEW.created_by_user_id IS NOT NULL
        THEN 'staff_manual'
      WHEN NEW.source_cart_id IS NOT NULL
           AND NEW.customer_user_id IS NOT NULL
           AND NEW.client_request_id IS NOT NULL
        THEN 'customer_checkout'
      WHEN NEW.source_cart_id IS NOT NULL
        THEN 'legacy_cart'
      ELSE NULL
    END;
  ELSE
    NEW.order_source := lower(btrim(NEW.order_source));
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_creation_source_derive_trg"
  ON "japan_underwear"."orders";
--> statement-breakpoint
CREATE TRIGGER "orders_creation_source_derive_trg"
BEFORE INSERT
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."derive_order_creation_source"();
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  DROP CONSTRAINT IF EXISTS "orders_order_source_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD CONSTRAINT "orders_order_source_chk" CHECK (
    "order_source" IN ('legacy_cart', 'customer_checkout', 'staff_manual')
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  VALIDATE CONSTRAINT "orders_order_source_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  DROP CONSTRAINT IF EXISTS "orders_creation_identity_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD CONSTRAINT "orders_creation_identity_chk" CHECK (
    (
      "order_source" = 'legacy_cart'
      AND "source_cart_id" IS NOT NULL
      AND "customer_user_id" IS NULL
      AND "client_request_id" IS NULL
      AND "manual_request_id" IS NULL
      AND "created_by_user_id" IS NULL
    )
    OR (
      "order_source" = 'customer_checkout'
      AND "source_cart_id" IS NOT NULL
      AND "customer_user_id" IS NOT NULL
      AND "client_request_id" IS NOT NULL
      AND "manual_request_id" IS NULL
      AND "created_by_user_id" IS NULL
    )
    OR (
      "order_source" = 'staff_manual'
      AND "source_cart_id" IS NULL
      AND "client_request_id" IS NULL
      AND "manual_request_id" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  VALIDATE CONSTRAINT "orders_creation_identity_chk";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_staff_manual_request_uidx"
  ON "japan_underwear"."orders" ("created_by_user_id", "manual_request_id")
  WHERE "order_source" = 'staff_manual';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_source_created_idx"
  ON "japan_underwear"."orders" ("order_source", "created_at" DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."protect_order_customer_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_source IS DISTINCT FROM OLD.order_source THEN
    RAISE EXCEPTION 'Order source cannot be changed.' USING ERRCODE = '23514';
  END IF;

  IF NEW.source_cart_id IS DISTINCT FROM OLD.source_cart_id THEN
    RAISE EXCEPTION 'Order source cart cannot be changed.' USING ERRCODE = '23514';
  END IF;

  IF OLD.customer_user_id IS NOT NULL
     AND NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id THEN
    RAISE EXCEPTION 'Order customer owner cannot be changed once assigned.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.client_request_id IS NOT NULL
     AND NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'Order client request id cannot be changed once assigned.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.manual_request_id IS DISTINCT FROM OLD.manual_request_id THEN
    RAISE EXCEPTION 'Order manual request id cannot be changed.' USING ERRCODE = '23514';
  END IF;

  IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'Order creator cannot be changed.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_customer_owner_guard_trg"
  ON "japan_underwear"."orders";
--> statement-breakpoint
CREATE TRIGGER "orders_customer_owner_guard_trg"
BEFORE UPDATE OF
  "order_source",
  "source_cart_id",
  "customer_user_id",
  "client_request_id",
  "manual_request_id",
  "created_by_user_id"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."protect_order_customer_owner"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."record_order_status_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_actor_source text;
  event_actor_label text;
  event_reason text;
  event_idempotency_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  event_actor_source := NULLIF(
    btrim(current_setting('japan_underwear.order_status_actor_source', true)),
    ''
  );
  event_actor_label := NULLIF(
    btrim(current_setting('japan_underwear.order_status_actor_label', true)),
    ''
  );
  event_reason := NULLIF(
    btrim(current_setting('japan_underwear.order_status_reason', true)),
    ''
  );
  event_idempotency_key := NULLIF(
    btrim(current_setting('japan_underwear.order_status_idempotency_key', true)),
    ''
  );

  IF TG_OP = 'INSERT' THEN
    event_actor_source := COALESCE(
      event_actor_source,
      CASE NEW.order_source
        WHEN 'staff_manual' THEN 'staff_manual'
        WHEN 'customer_checkout' THEN 'checkout'
        ELSE 'legacy'
      END
    );
    event_actor_label := COALESCE(
      event_actor_label,
      CASE NEW.order_source
        WHEN 'staff_manual' THEN 'staff-manual-order'
        WHEN 'customer_checkout' THEN 'customer-checkout'
        ELSE 'legacy-order-create'
      END
    );
    event_idempotency_key := COALESCE(
      event_idempotency_key,
      CASE
        WHEN NEW.order_source = 'staff_manual' THEN
          'manual-create:' || NEW.created_by_user_id::text || ':' || NEW.manual_request_id::text
        WHEN NEW.source_cart_id IS NOT NULL THEN
          'checkout:' || NEW.source_cart_id::text
        ELSE
          'order-create:' || NEW.id::text
      END
    );
  ELSE
    event_actor_source := COALESCE(event_actor_source, 'system');
    event_actor_label := COALESCE(event_actor_label, 'direct-database-update');
  END IF;

  INSERT INTO "japan_underwear"."order_status_events" (
    order_id,
    from_status,
    to_status,
    actor_source,
    actor_label,
    reason,
    idempotency_key
  )
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    event_actor_source,
    event_actor_label,
    event_reason,
    event_idempotency_key
  );

  RETURN NEW;
END;
$$;