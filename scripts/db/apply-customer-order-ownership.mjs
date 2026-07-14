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
];
const MIGRATION_CREATED_AT = 1783880000000;
const MIGRATION_PATH = new URL("../../drizzle/0008_customer_order_ownership.sql", import.meta.url);

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
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relations.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0008: ${missingRelations.join(", ")}.`);
  }

  const migrationResult = await client.query(
    "SELECT created_at FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])",
    [REQUIRED_MIGRATIONS],
  );
  const applied = new Set(migrationResult.rows.map((row) => Number(row.created_at)));
  const missing = REQUIRED_MIGRATIONS.filter((createdAt) => !applied.has(createdAt));
  if (missing.length > 0) {
    throw new Error(`Thiếu migration nền trước 0008: ${missing.join(", ")}.`);
  }
}

async function verifyAppliedState() {
  const columnResult = await client.query(`
    SELECT data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'orders'
      AND column_name = 'customer_user_id'
  `);
  if (columnResult.rowCount !== 1 || columnResult.rows[0].data_type !== "uuid") {
    throw new Error("Hậu kiểm 0008 thiếu orders.customer_user_id kiểu uuid.");
  }
  if (columnResult.rows[0].is_nullable !== "YES") {
    throw new Error("orders.customer_user_id phải nullable để giữ đơn legacy/staff không có customer owner.");
  }

  const constraintResult = await client.query(`
    SELECT count(*)::integer AS count
    FROM pg_constraint
    WHERE conrelid = 'japan_underwear.orders'::regclass
      AND conname = 'orders_customer_user_id_users_id_fk'
      AND contype = 'f'
  `);
  if (Number(constraintResult.rows[0]?.count ?? 0) !== 1) {
    throw new Error("Hậu kiểm 0008 thiếu foreign key customer owner.");
  }

  const indexResult = await client.query(`
    SELECT count(*)::integer AS count
    FROM pg_indexes
    WHERE schemaname = 'japan_underwear'
      AND indexname = 'orders_customer_user_created_idx'
  `);
  if (Number(indexResult.rows[0]?.count ?? 0) !== 1) {
    throw new Error("Hậu kiểm 0008 thiếu index lịch sử đơn theo customer.");
  }

  const triggerResult = await client.query(`
    SELECT count(DISTINCT trigger_name)::integer AS count
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND event_object_table = 'orders'
      AND trigger_name = 'orders_customer_owner_guard_trg'
  `);
  if (Number(triggerResult.rows[0]?.count ?? 0) !== 1) {
    throw new Error("Hậu kiểm 0008 thiếu trigger khóa owner đơn hàng.");
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:customer-order-ownership-migration'))",
    );
    await assertRequiredState();
    const statements = splitMigrationStatements(migrationSql);
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        throw new Error(
          `Statement ${index + 1}/${statements.length} của migration 0008 thất bại: ${formatPgError(error)}`,
        );
      }
    }
    await verifyAppliedState();
    await reconcileJournal(migrationHash);
    await client.query("COMMIT");
    console.log("Customer order ownership migration OK.");
    console.log("Authenticated checkout writes the internal user UUID in the order transaction.");
    console.log("Legacy/staff orders may remain unowned; assigned order owners are immutable.");
    console.log("Migration record 0008 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Customer order ownership migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
