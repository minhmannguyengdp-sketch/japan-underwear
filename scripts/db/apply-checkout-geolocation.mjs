import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const REQUIRED_MIGRATIONS = [
  1783842973000,
  1783845000000,
  1783849000000,
  1783853000000,
  1783860000000,
  1783865000000,
];
const MIGRATION_CREATED_AT = 1783870000000;
const MIGRATION_PATH = new URL("../../drizzle/0006_checkout_geolocation.sql", import.meta.url);
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

function formatPgError(error) {
  if (!(error instanceof Error)) return String(error);
  const details = [error.message];
  if (error.code) details.push(`code=${error.code}`);
  if (error.detail) details.push(`detail=${error.detail}`);
  if (error.hint) details.push(`hint=${error.hint}`);
  if (error.constraint) details.push(`constraint=${error.constraint}`);
  if (error.table) details.push(`table=${error.table}`);
  return details.join(" | ");
}

function splitMigrationStatements(sql) {
  return sql
    .split(/\s*--> statement-breakpoint\s*/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});

async function assertRequiredState() {
  const relationResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.orders') AS orders,
      to_regclass('japan_underwear.order_status_events') AS order_status_events,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relationResult.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0006: ${missingRelations.join(", ")}.`);
  }

  const migrationResult = await client.query(
    `
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      WHERE created_at = ANY($1::bigint[])
    `,
    [REQUIRED_MIGRATIONS],
  );
  const applied = new Set(migrationResult.rows.map((row) => Number(row.created_at)));
  const missingMigrations = REQUIRED_MIGRATIONS.filter((createdAt) => !applied.has(createdAt));
  if (missingMigrations.length > 0) {
    throw new Error(`Thiếu migration nền trước 0006: ${missingMigrations.join(", ")}.`);
  }
}

async function applyMigrationStatements(migrationSql) {
  const statements = splitMigrationStatements(migrationSql);
  if (statements.length === 0) throw new Error("Migration 0006 không có statement để chạy.");

  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0006 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0006.`);
}

async function verifyAppliedState() {
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
    throw new Error(`Hậu kiểm 0006 thiếu cột: ${missingColumns.join(", ")}.`);
  }
  for (const name of REQUIRED_COLUMNS) {
    if (columns.get(name).is_nullable !== "YES") {
      throw new Error(`Hậu kiểm 0006: orders.${name} phải nullable.`);
    }
  }

  const constraintResult = await client.query(
    `
      SELECT constraint_definition.conname AS constraint_name
      FROM pg_constraint AS constraint_definition
      WHERE constraint_definition.conrelid = 'japan_underwear.orders'::regclass
        AND constraint_definition.conname = ANY($1::text[])
      ORDER BY constraint_definition.conname
    `,
    [REQUIRED_CONSTRAINTS],
  );
  const constraints = new Set(
    constraintResult.rows.map((row) => String(row.constraint_name)),
  );
  const missingConstraints = REQUIRED_CONSTRAINTS.filter((name) => !constraints.has(name));
  if (missingConstraints.length > 0) {
    throw new Error(`Hậu kiểm 0006 thiếu constraint: ${missingConstraints.join(", ")}.`);
  }
}

async function reconcileJournal(migrationHash) {
  await client.query(
    "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [MIGRATION_CREATED_AT],
  );
  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [migrationHash, MIGRATION_CREATED_AT],
  );
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto.createHash("sha256").update(migrationSql).digest("hex");

  await client.connect();
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:checkout-geolocation-migration'))",
    );

    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();

    console.log("  - Áp cột và constraint định vị checkout...");
    await applyMigrationStatements(migrationSql);

    console.log("  - Hậu kiểm cột nullable và constraint vị trí...");
    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal cho 0006...");
    await reconcileJournal(migrationHash);

    await client.query("COMMIT");
    console.log("Checkout geolocation migration OK.");
    console.log("Location fields are optional and all-or-none.");
    console.log("Location source: browser_geolocation only.");
    console.log("Migration record 0006 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Checkout geolocation migration failed: ${formatPgError(error)}`);
  process.exit(1);
});