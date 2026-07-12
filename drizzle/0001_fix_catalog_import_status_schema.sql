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
DECLARE
  current_type_schema text;
  current_type_name text;
BEGIN
  SELECT type_namespace.nspname,
         type_definition.typname
    INTO current_type_schema,
         current_type_name
  FROM pg_attribute AS attribute
  JOIN pg_class AS table_definition
    ON table_definition.oid = attribute.attrelid
  JOIN pg_namespace AS table_namespace
    ON table_namespace.oid = table_definition.relnamespace
  JOIN pg_type AS type_definition
    ON type_definition.oid = attribute.atttypid
  JOIN pg_namespace AS type_namespace
    ON type_namespace.oid = type_definition.typnamespace
  WHERE table_namespace.nspname = 'japan_underwear'
    AND table_definition.relname = 'catalog_import_runs'
    AND attribute.attname = 'status'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF current_type_schema IS NULL THEN
    RAISE EXCEPTION 'Could not resolve japan_underwear.catalog_import_runs.status type';
  END IF;

  IF current_type_name <> 'catalog_import_status'
     OR current_type_schema NOT IN ('public', 'japan_underwear') THEN
    RAISE EXCEPTION 'Unexpected catalog import status type: %.%',
      current_type_schema,
      current_type_name;
  END IF;

  IF current_type_schema = 'public' THEN
    ALTER TABLE "japan_underwear"."catalog_import_runs"
      ALTER COLUMN "status" DROP DEFAULT;

    ALTER TABLE "japan_underwear"."catalog_import_runs"
      ALTER COLUMN "status"
      TYPE "japan_underwear"."catalog_import_status"
      USING "status"::text::"japan_underwear"."catalog_import_status";

    ALTER TABLE "japan_underwear"."catalog_import_runs"
      ALTER COLUMN "status"
      SET DEFAULT 'pending'::"japan_underwear"."catalog_import_status";
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
    DROP TYPE "public"."catalog_import_status" RESTRICT;
  END IF;
END
$$;
