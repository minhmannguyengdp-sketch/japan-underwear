import crypto from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";

const BASELINE_CREATED_AT = 1783842973000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0000_parallel_trauma.sql",
  import.meta.url,
);

const EXPECTED_TABLES = [
  "brands",
  "catalog_import_runs",
  "categories",
  "product_colors",
  "product_images",
  "product_variants",
  "products",
];

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

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto
    .createHash("sha256")
    .update(migrationSql)
    .digest("hex");

  await client.connect();
  await client.query("BEGIN");

  try {
    const tableResult = await client.query(
      `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'japan_underwear'
        ORDER BY tablename
      `,
    );

    const actualTables = tableResult.rows.map((row) => row.tablename);
    const missingTables = EXPECTED_TABLES.filter(
      (tableName) => !actualTables.includes(tableName),
    );
    const unexpectedTables = actualTables.filter(
      (tableName) => !EXPECTED_TABLES.includes(tableName),
    );

    if (missingTables.length > 0 || unexpectedTables.length > 0) {
      throw new Error(
        `Catalog schema mismatch. Missing: ${missingTables.join(", ") || "none"}. Unexpected: ${unexpectedTables.join(", ") || "none"}.`,
      );
    }

    for (const tableName of EXPECTED_TABLES) {
      const countResult = await client.query(
        `SELECT COUNT(*)::bigint AS count FROM "japan_underwear"."${tableName}"`,
      );
      const rowCount = BigInt(countResult.rows[0].count);

      if (rowCount !== 0n) {
        throw new Error(
          `Refusing to baseline: japan_underwear.${tableName} contains ${rowCount.toString()} rows.`,
        );
      }
    }

    const statusTypeResult = await client.query(
      `
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
      `,
    );

    if (statusTypeResult.rowCount !== 1) {
      throw new Error(
        "Could not resolve japan_underwear.catalog_import_runs.status type.",
      );
    }

    const { type_schema: statusTypeSchema, type_name: statusTypeName } =
      statusTypeResult.rows[0];

    if (
      statusTypeName !== "catalog_import_status" ||
      !["public", "japan_underwear"].includes(statusTypeSchema)
    ) {
      throw new Error(
        `Unexpected catalog import status type: ${statusTypeSchema}.${statusTypeName}.`,
      );
    }

    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const existingBaseline = await client.query(
      `
        SELECT id, hash
        FROM "drizzle"."__drizzle_migrations"
        WHERE created_at = $1
        LIMIT 1
      `,
      [BASELINE_CREATED_AT],
    );

    if (existingBaseline.rowCount === 0) {
      await client.query(
        `
          INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
          VALUES ($1, $2)
        `,
        [migrationHash, BASELINE_CREATED_AT],
      );
      console.log("Drizzle baseline recorded for 0000_parallel_trauma.");
    } else {
      console.log("Drizzle baseline already exists for 0000_parallel_trauma.");
    }

    await client.query("COMMIT");
    console.log(`Catalog tables verified: ${EXPECTED_TABLES.length}.`);
    console.log(`Current status enum schema: ${statusTypeSchema}.`);
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
