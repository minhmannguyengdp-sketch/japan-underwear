import crypto from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";

const EXPECTED_LABELS = ["pending", "running", "completed", "failed"];
const BASELINE_CREATED_AT = 1783842973000;
const REPAIR_CREATED_AT = 1783845000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0001_fix_catalog_import_status_schema.sql",
  import.meta.url,
);

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const isLocalDatabase = /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(
  connectionString,
);

const client = new Client({
  connectionString,
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
});

async function getEnumLabels(schemaName) {
  const result = await client.query(
    `
      SELECT enum_value.enumlabel
      FROM pg_type AS type_definition
      JOIN pg_namespace AS namespace
        ON namespace.oid = type_definition.typnamespace
      JOIN pg_enum AS enum_value
        ON enum_value.enumtypid = type_definition.oid
      WHERE namespace.nspname = $1
        AND type_definition.typname = 'catalog_import_status'
      ORDER BY enum_value.enumsortorder
    `,
    [schemaName],
  );

  return result.rows.map((row) => row.enumlabel);
}

function assertLabels(schemaName, labels) {
  if (
    labels.length !== EXPECTED_LABELS.length ||
    labels.some((label, index) => label !== EXPECTED_LABELS[index])
  ) {
    throw new Error(
      `${schemaName}.catalog_import_status has unexpected labels: ${labels.join(", ") || "none"}.`,
    );
  }
}

async function getStatusColumnType() {
  const result = await client.query(`
    SELECT type_namespace.nspname AS type_schema,
           type_definition.typname AS type_name
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
      AND NOT attribute.attisdropped
  `);

  if (result.rowCount !== 1) {
    throw new Error(
      "Could not resolve japan_underwear.catalog_import_runs.status type.",
    );
  }

  return result.rows[0];
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto
    .createHash("sha256")
    .update(migrationSql)
    .digest("hex");

  await client.connect();
  await client.query("BEGIN");

  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:catalog-enum-repair'))",
    );

    const tableResult = await client.query(
      "SELECT to_regclass('japan_underwear.catalog_import_runs') AS table_name",
    );

    if (!tableResult.rows[0].table_name) {
      throw new Error(
        "japan_underwear.catalog_import_runs does not exist; refusing repair.",
      );
    }

    const currentType = await getStatusColumnType();

    if (
      currentType.type_name !== "catalog_import_status" ||
      !["public", "japan_underwear"].includes(currentType.type_schema)
    ) {
      throw new Error(
        `Unexpected status type: ${currentType.type_schema}.${currentType.type_name}.`,
      );
    }

    const currentLabels = await getEnumLabels(currentType.type_schema);
    assertLabels(currentType.type_schema, currentLabels);

    await client.query('CREATE SCHEMA IF NOT EXISTS "japan_underwear"');

    const targetLabels = await getEnumLabels("japan_underwear");

    if (targetLabels.length === 0) {
      await client.query(`
        CREATE TYPE "japan_underwear"."catalog_import_status" AS ENUM (
          'pending',
          'running',
          'completed',
          'failed'
        )
      `);
    } else {
      assertLabels("japan_underwear", targetLabels);
    }

    if (currentType.type_schema !== "japan_underwear") {
      await client.query(`
        ALTER TABLE "japan_underwear"."catalog_import_runs"
          ALTER COLUMN "status" DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE "japan_underwear"."catalog_import_runs"
          ALTER COLUMN "status"
          TYPE "japan_underwear"."catalog_import_status"
          USING "status"::text::"japan_underwear"."catalog_import_status"
      `);

      await client.query(`
        ALTER TABLE "japan_underwear"."catalog_import_runs"
          ALTER COLUMN "status"
          SET DEFAULT 'pending'::"japan_underwear"."catalog_import_status"
      `);
    }

    const publicEnumLabels = await getEnumLabels("public");

    if (publicEnumLabels.length > 0) {
      assertLabels("public", publicEnumLabels);

      const publicEnumUsers = await client.query(`
        SELECT table_namespace.nspname AS table_schema,
               table_definition.relname AS table_name,
               attribute.attname AS column_name
        FROM pg_attribute AS attribute
        JOIN pg_class AS table_definition
          ON table_definition.oid = attribute.attrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_definition.relnamespace
        WHERE attribute.atttypid = 'public.catalog_import_status'::regtype
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      `);

      if (publicEnumUsers.rowCount > 0) {
        const users = publicEnumUsers.rows
          .map(
            (row) =>
              `${row.table_schema}.${row.table_name}.${row.column_name}`,
          )
          .join(", ");
        throw new Error(
          `Refusing to drop public.catalog_import_status; still used by: ${users}.`,
        );
      }

      await client.query('DROP TYPE "public"."catalog_import_status" RESTRICT');
    }

    const baselineResult = await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM drizzle.__drizzle_migrations
        WHERE created_at = $1
      `,
      [BASELINE_CREATED_AT],
    );

    if (baselineResult.rows[0].count < 1) {
      throw new Error(
        "Missing baseline migration record for 0000_parallel_trauma.",
      );
    }

    await client.query(
      `
        DELETE FROM drizzle.__drizzle_migrations
        WHERE created_at = $1
      `,
      [REPAIR_CREATED_AT],
    );

    await client.query(
      `
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES ($1, $2)
      `,
      [migrationHash, REPAIR_CREATED_AT],
    );

    const repairedType = await getStatusColumnType();
    const repairedTargetLabels = await getEnumLabels("japan_underwear");
    const repairedPublicLabels = await getEnumLabels("public");

    assertLabels("japan_underwear", repairedTargetLabels);

    if (
      repairedType.type_schema !== "japan_underwear" ||
      repairedType.type_name !== "catalog_import_status"
    ) {
      throw new Error(
        "Repair verification failed: status column still uses the wrong enum.",
      );
    }

    if (repairedPublicLabels.length > 0) {
      throw new Error(
        "Repair verification failed: public.catalog_import_status still exists.",
      );
    }

    await client.query("COMMIT");
    console.log("Catalog enum repair OK.");
    console.log(
      "Enum: japan_underwear.catalog_import_status (pending, running, completed, failed).",
    );
    console.log("Migration record 0001 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
