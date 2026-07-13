ALTER TABLE "japan_underwear"."orders"
  ADD COLUMN IF NOT EXISTS "delivery_latitude" double precision,
  ADD COLUMN IF NOT EXISTS "delivery_longitude" double precision,
  ADD COLUMN IF NOT EXISTS "delivery_accuracy_meters" double precision,
  ADD COLUMN IF NOT EXISTS "location_collected_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "location_source" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_all_or_none_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_all_or_none_chk" CHECK (
        num_nonnulls(
          "delivery_latitude",
          "delivery_longitude",
          "delivery_accuracy_meters",
          "location_collected_at",
          "location_source"
        ) IN (0, 5)
      );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_latitude_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_latitude_chk" CHECK (
        "delivery_latitude" IS NULL OR "delivery_latitude" BETWEEN -90 AND 90
      );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_longitude_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_longitude_chk" CHECK (
        "delivery_longitude" IS NULL OR "delivery_longitude" BETWEEN -180 AND 180
      );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_accuracy_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_accuracy_chk" CHECK (
        "delivery_accuracy_meters" IS NULL
        OR "delivery_accuracy_meters" > 0
           AND "delivery_accuracy_meters" <= 100000
      );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_collected_at_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_collected_at_chk" CHECK (
        "location_collected_at" IS NULL
        OR "location_collected_at" >= TIMESTAMPTZ '2000-01-01 00:00:00+00'
      );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_location_source_chk'
      AND conrelid = 'japan_underwear.orders'::regclass
  ) THEN
    ALTER TABLE "japan_underwear"."orders"
      ADD CONSTRAINT "orders_location_source_chk" CHECK (
        "location_source" IS NULL OR "location_source" = 'browser_geolocation'
      );
  END IF;
END $$;