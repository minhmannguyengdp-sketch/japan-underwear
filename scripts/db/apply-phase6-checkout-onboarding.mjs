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
  1783870000000,
  1783875000000,
  1783880000000,
];
const MIGRATION_CREATED_AT = 1783885000000;
const MIGRATION_PATH = new URL("../../drizzle/0009_phase6_checkout_onboarding.sql", import.meta.url);

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
  for (const key of ["code", "detail", "hint", "constraint", "table"]) {
    if (error[key]) details.push(`${key}=${error[key]}`);
  }
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
  const relations = await client.query(`
    SELECT
      to_regclass('japan_underwear.orders') AS orders,
      to_regclass('japan_underwear.users') AS users,
      to_regclass('japan_underwear.carts') AS carts,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relations.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0009: ${missingRelations.join(", ")}.`);
  }

  const migrationResult = await client.query(
    "SELECT created_at FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])",
    [REQUIRED_MIGRATIONS],
  );
  const applied = new Set(migrationResult.rows.map((row) => Number(row.created_at)));
  const missing = REQUIRED_MIGRATIONS.filter((createdAt) => !applied.has(createdAt));
  if (missing.length > 0) {
    throw new Error(`Thiếu migration nền trước 0009: ${missing.join(", ")}.`);
  }
}

async function verifyAppliedState() {
  const relations = await client.query(`
    SELECT
      to_regclass('japan_underwear.customer_profiles') AS customer_profiles,
      to_regclass('japan_underwear.outbox_events') AS outbox_events
  `);
  if (!relations.rows[0]?.customer_profiles || !relations.rows[0]?.outbox_events) {
    throw new Error("Hậu kiểm 0009 thiếu customer_profiles hoặc outbox_events.");
  }

  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'orders'
      AND column_name = ANY(ARRAY['client_request_id', 'customer_store_name']::text[])
  `);
  const columnByName = new Map(columns.rows.map((row) => [String(row.column_name), row]));
  const clientRequest = columnByName.get("client_request_id");
  const storeName = columnByName.get("customer_store_name");
  if (!clientRequest || clientRequest.data_type !== "uuid" || clientRequest.is_nullable !== "YES") {
    throw new Error("orders.client_request_id phải là uuid nullable.");
  }
  if (!storeName || storeName.data_type !== "text" || storeName.is_nullable !== "YES") {
    throw new Error("orders.customer_store_name phải là text nullable cho đơn legacy.");
  }

  const indexResult = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'japan_underwear'
      AND indexname = ANY(ARRAY[
        'orders_customer_client_request_uidx',
        'outbox_events_order_event_uidx',
        'outbox_events_dispatch_idx',
        'customer_profiles_phone_idx'
      ]::text[])
  `);
  const indexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
  for (const name of [
    "orders_customer_client_request_uidx",
    "outbox_events_order_event_uidx",
    "outbox_events_dispatch_idx",
    "customer_profiles_phone_idx",
  ]) {
    if (!indexes.has(name)) throw new Error(`Hậu kiểm 0009 thiếu index ${name}.`);
  }

  const triggerResult = await client.query(`
    SELECT DISTINCT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND trigger_name = ANY(ARRAY[
        'customer_profiles_normalize_trg',
        'orders_customer_owner_guard_trg'
      ]::text[])
  `);
  const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
  for (const name of ["customer_profiles_normalize_trg", "orders_customer_owner_guard_trg"]) {
    if (!triggers.has(name)) throw new Error(`Hậu kiểm 0009 thiếu trigger ${name}.`);
  }
}

async function reconcileJournal(migrationHash) {
  await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [
    MIGRATION_CREATED_AT,
  ]);
  await client.query(
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:phase6-checkout-onboarding-migration'))",
    );
    await assertRequiredState();
    const statements = splitMigrationStatements(migrationSql);
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        throw new Error(
          `Statement ${index + 1}/${statements.length} của migration 0009 thất bại: ${formatPgError(error)}`,
        );
      }
    }
    await verifyAppliedState();
    await reconcileJournal(migrationHash);
    await client.query("COMMIT");
    console.log("Phase 6 checkout and onboarding migration OK.");
    console.log("Customer profile: store + contact + phone + delivery address.");
    console.log("Checkout idempotency: customer_user_id + client_request_id.");
    console.log("Transactional outbox: order.submitted event in japan_underwear.outbox_events.");
    console.log("Migration record 0009 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Phase 6 migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
