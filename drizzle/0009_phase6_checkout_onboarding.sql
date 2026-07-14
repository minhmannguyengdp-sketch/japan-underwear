CREATE TABLE IF NOT EXISTS "japan_underwear"."customer_profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "store_name" text NOT NULL,
  "contact_name" text NOT NULL,
  "phone" text NOT NULL,
  "delivery_address" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "customer_profiles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "japan_underwear"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "customer_profiles_store_name_nonempty_chk" CHECK (btrim("store_name") <> ''),
  CONSTRAINT "customer_profiles_contact_name_nonempty_chk" CHECK (btrim("contact_name") <> ''),
  CONSTRAINT "customer_profiles_phone_chk" CHECK (
    char_length(btrim("phone")) BETWEEN 8 AND 24
    AND "phone" ~ '^[0-9+().[:space:]-]+$'
  ),
  CONSTRAINT "customer_profiles_delivery_address_nonempty_chk" CHECK (btrim("delivery_address") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_phone_idx"
  ON "japan_underwear"."customer_profiles" ("phone");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."normalize_customer_profile"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.store_name := btrim(NEW.store_name);
  NEW.contact_name := btrim(NEW.contact_name);
  NEW.phone := btrim(NEW.phone);
  NEW.delivery_address := btrim(NEW.delivery_address);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "customer_profiles_normalize_trg"
  ON "japan_underwear"."customer_profiles";
--> statement-breakpoint
CREATE TRIGGER "customer_profiles_normalize_trg"
BEFORE INSERT OR UPDATE
ON "japan_underwear"."customer_profiles"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."normalize_customer_profile"();
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "client_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "customer_store_name" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.orders'::regclass
      AND conname = 'orders_client_request_owner_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_client_request_owner_chk"
      CHECK (client_request_id IS NULL OR customer_user_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.orders'::regclass
      AND conname = 'orders_customer_store_name_nonempty_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_customer_store_name_nonempty_chk"
      CHECK (customer_store_name IS NULL OR btrim(customer_store_name) <> '');
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_customer_client_request_uidx"
  ON "japan_underwear"."orders" ("customer_user_id", "client_request_id")
  WHERE "customer_user_id" IS NOT NULL AND "client_request_id" IS NOT NULL;
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

  IF OLD.client_request_id IS NOT NULL
     AND NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'Order client request id cannot be changed once assigned.'
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
BEFORE UPDATE OF "customer_user_id", "client_request_id"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."protect_order_customer_owner"();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aggregate_type" text DEFAULT 'order' NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "published_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "outbox_events_aggregate_id_orders_id_fk"
    FOREIGN KEY ("aggregate_id") REFERENCES "japan_underwear"."orders"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "outbox_events_aggregate_type_nonempty_chk" CHECK (btrim("aggregate_type") <> ''),
  CONSTRAINT "outbox_events_event_type_nonempty_chk" CHECK (btrim("event_type") <> ''),
  CONSTRAINT "outbox_events_status_chk" CHECK ("status" IN ('pending', 'published', 'failed')),
  CONSTRAINT "outbox_events_attempts_chk" CHECK ("attempts" >= 0),
  CONSTRAINT "outbox_events_published_state_chk" CHECK (
    ("status" = 'published' AND "published_at" IS NOT NULL)
    OR ("status" <> 'published' AND "published_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_order_event_uidx"
  ON "japan_underwear"."outbox_events" ("aggregate_id", "event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_dispatch_idx"
  ON "japan_underwear"."outbox_events" ("status", "available_at", "created_at");
