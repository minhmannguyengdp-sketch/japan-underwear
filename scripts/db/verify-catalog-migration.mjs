import { Client } from "pg";

const EXPECTED_TABLES = [
  "brands",
  "catalog_import_runs",
  "categories",
  "product_colors",
  "product_images",
  "product_variants",
  "products",
];

const EXPECTED_MIGRATIONS = [1783842973000, 1783845000000];
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
  await client.connect();

  try {
    const tableResult = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'japan_underwear'
      ORDER BY tablename
    `);

    const actualTables = tableResult.rows.map((row) => row.tablename);
    const missingTables = EXPECTED_TABLES.filter(
      (tableName) => !actualTables.includes(tableName),
    );
    const unexpectedTables = actualTables.filter(
      (tableName) => !EXPECTED_TABLES.includes(tableName),
    );

    if (missingTables.length > 0 || unexpectedTables.length > 0) {
      throw new Error(
        `Catalog table mismatch. Missing: ${missingTables.join(", ") || "none"}. Unexpected: ${unexpectedTables.join(", ") || "none"}.`,
      );
    }

    const enumResult = await client.query(`
      SELECT namespace.nspname AS schema_name,
             type_definition.typname AS type_name
      FROM pg_type AS type_definition
      JOIN pg_namespace AS namespace
        ON namespace.oid = type_definition.typnamespace
      WHERE type_definition.typname = 'catalog_import_status'
      ORDER BY namespace.nspname
    `);

    const enumSchemas = enumResult.rows.map((row) => row.schema_name);

    if (
      enumSchemas.length !== 1 ||
      enumSchemas[0] !== "japan_underwear"
    ) {
      throw new Error(
        `Expected only japan_underwear.catalog_import_status, found: ${enumSchemas.join(", ") || "none"}.`,
      );
    }

    const columnTypeResult = await client.query(`
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

    if (
      columnTypeResult.rowCount !== 1 ||
      columnTypeResult.rows[0].type_schema !== "japan_underwear" ||
      columnTypeResult.rows[0].type_name !== "catalog_import_status"
    ) {
      throw new Error(
        "catalog_import_runs.status does not use japan_underwear.catalog_import_status.",
      );
    }

    const migrationTableResult = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
    );

    if (!migrationTableResult.rows[0].table_name) {
      throw new Error("drizzle.__drizzle_migrations does not exist.");
    }

    const migrationResult = await client.query(`
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at
    `);

    const appliedMigrations = migrationResult.rows.map((row) =>
      Number(row.created_at),
    );
    const missingMigrations = EXPECTED_MIGRATIONS.filter(
      (createdAt) => !appliedMigrations.includes(createdAt),
    );

    if (missingMigrations.length > 0) {
      throw new Error(
        `Missing Drizzle migration records: ${missingMigrations.join(", ")}.`,
      );
    }

    console.log("Catalog DB verification OK.");
    console.log(`Tables: ${actualTables.length}.`);
    console.log("Enum: japan_underwear.catalog_import_status.");
    console.log(
      `Migration records: ${appliedMigrations.length} (${EXPECTED_MIGRATIONS.length} required records present).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
