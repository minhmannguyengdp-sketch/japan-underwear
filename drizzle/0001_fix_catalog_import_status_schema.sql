CREATE TYPE IF NOT EXISTS "japan_underwear"."catalog_import_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "japan_underwear"."catalog_import_runs" ALTER COLUMN "status" TYPE "japan_underwear"."catalog_import_status" USING "status"::text::"japan_underwear"."catalog_import_status";--> statement-breakpoint
