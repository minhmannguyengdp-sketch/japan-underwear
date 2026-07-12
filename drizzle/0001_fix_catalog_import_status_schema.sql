DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS t
    JOIN pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'japan_underwear'
      AND t.typname = 'catalog_import_status'
  ) THEN
    CREATE TYPE "japan_underwear"."catalog_import_status" AS ENUM (
      'pending',
      'running',
      'completed',
      'failed'
    );
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    JOIN pg_class AS c ON c.oid = a.attrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'japan_underwear'
      AND c.relname = 'catalog_import_runs'
      AND a.attname = 'status'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid <> 'japan_underwear.catalog_import_status'::regtype
  ) THEN
    ALTER TABLE "japan_underwear"."catalog_import_runs"
      ALTER COLUMN "status"
      TYPE "japan_underwear"."catalog_import_status"
      USING "status"::text::"japan_underwear"."catalog_import_status";
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type AS t
    JOIN pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'catalog_import_status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    WHERE a.atttypid = 'public.catalog_import_status'::regtype
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    DROP TYPE "public"."catalog_import_status";
  END IF;
END
$$;
