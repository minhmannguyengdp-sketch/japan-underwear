ALTER TABLE "japan_underwear"."customer_profiles"
  ADD COLUMN IF NOT EXISTS "shop_latitude" double precision,
  ADD COLUMN IF NOT EXISTS "shop_longitude" double precision,
  ADD COLUMN IF NOT EXISTS "shop_accuracy_meters" double precision,
  ADD COLUMN IF NOT EXISTS "shop_location_collected_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "shop_location_source" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_location_all_or_none_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_location_all_or_none_chk"
      CHECK (
        num_nonnulls(
          shop_latitude,
          shop_longitude,
          shop_accuracy_meters,
          shop_location_collected_at,
          shop_location_source
        ) IN (0, 5)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_latitude_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_latitude_chk"
      CHECK (shop_latitude IS NULL OR shop_latitude BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_longitude_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_longitude_chk"
      CHECK (shop_longitude IS NULL OR shop_longitude BETWEEN -180 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_accuracy_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_accuracy_chk"
      CHECK (
        shop_accuracy_meters IS NULL
        OR (shop_accuracy_meters > 0 AND shop_accuracy_meters <= 100000)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_collected_at_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_collected_at_chk"
      CHECK (
        shop_location_collected_at IS NULL
        OR shop_location_collected_at >= timestamptz '2000-01-01 00:00:00+00'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.customer_profiles'::regclass
      AND conname = 'customer_profiles_shop_source_chk'
  ) THEN
    ALTER TABLE "japan_underwear"."customer_profiles"
      ADD CONSTRAINT "customer_profiles_shop_source_chk"
      CHECK (
        shop_location_source IS NULL
        OR shop_location_source = 'browser_geolocation'
      );
  END IF;
END
$$;
