import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783870000000;
const REQUIRED_COLUMNS = [
  "delivery_latitude",
  "delivery_longitude",
  "delivery_accuracy_meters",
  "location_collected_at",
  "location_source",
];
const REQUIRED_CONSTRAINTS = [
  "orders_location_all_or_none_chk",
  "orders_location_latitude_chk",
  "orders_location_longitude_chk",
  "orders_location_accuracy_chk",
  "orders_location_collected_at_chk",
  "orders_location_source_chk",
];

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Thiếu DATABASE_URL trong .env.local hoặc .env.");
  process.exit(1);
}

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

async function main() {
  await client.connect();
  try {
    const columnResult = await client.query(
      `
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'orders'
          AND column_name = ANY($1::text[])
        ORDER BY column_name
      `,
      [REQUIRED_COLUMNS],
    );
    const columns = new Map(columnResult.rows.map((row) => [String(row.column_name), row]));
    const missingColumns = REQUIRED_COLUMNS.filter((name) => !columns.has(name));
    if (missingColumns.length > 0) {
      throw new Error(`Missing order location columns: ${missingColumns.join(", ")}.`);
    }
    for (const name of REQUIRED_COLUMNS) {
      if (columns.get(name).is_nullable !== "YES") {
        throw new Error(`orders.${name} must be nullable.`);
      }
    }

    const constraintResult = await client.query(
      `
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'japan_underwear.orders'::regclass
          AND conname = ANY($1::text[])
      `,
      [REQUIRED_CONSTRAINTS],
    );
    const constraints = new Set(constraintResult.rows.map((row) => String(row.conname)));
    const missingConstraints = REQUIRED_CONSTRAINTS.filter((name) => !constraints.has(name));
    if (missingConstraints.length > 0) {
      throw new Error(`Missing order location constraints: ${missingConstraints.join(", ")}.`);
    }

    const invalidRows = await client.query(`
      SELECT count(*)::integer AS invalid_count
      FROM japan_underwear.orders
      WHERE num_nonnulls(
        delivery_latitude,
        delivery_longitude,
        delivery_accuracy_meters,
        location_collected_at,
        location_source
      ) NOT IN (0, 5)
         OR delivery_latitude IS NOT NULL AND delivery_latitude NOT BETWEEN -90 AND 90
         OR delivery_longitude IS NOT NULL AND delivery_longitude NOT BETWEEN -180 AND 180
         OR delivery_accuracy_meters IS NOT NULL
            AND (delivery_accuracy_meters <= 0 OR delivery_accuracy_meters > 100000)
         OR location_source IS NOT NULL AND location_source <> 'browser_geolocation'
    `);
    if (Number(invalidRows.rows[0]?.invalid_count ?? 0) !== 0) {
      throw new Error("Invalid checkout geolocation row found.");
    }

    const migrationResult = await client.query(
      "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [MIGRATION_CREATED_AT],
    );
    if (migrationResult.rowCount !== 1) {
      throw new Error(`Missing Drizzle migration record ${MIGRATION_CREATED_AT}.`);
    }

    const coverage = await client.query(`
      SELECT
        count(*)::integer AS order_count,
        count(*) FILTER (WHERE delivery_latitude IS NOT NULL)::integer AS located_order_count
      FROM japan_underwear.orders
    `);

    console.log("Checkout geolocation verification OK.");
    console.log("Location is optional and stored as an order snapshot.");
    console.log("Consent model: browser geolocation only after an explicit user action.");
    console.log(
      `Orders: ${Number(coverage.rows[0]?.order_count ?? 0)}; with location: ${Number(coverage.rows[0]?.located_order_count ?? 0)}.`,
    );
    console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});