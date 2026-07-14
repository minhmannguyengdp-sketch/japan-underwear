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
  1783885000000,
  1783890000000,
];
const MIGRATION_CREATED_AT = 1783895000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0011_manual_order_shared_service.sql",
  import.meta.url,
);
const REQUIRED_COLUMNS = [
  "order_source",
  "manual_request_id",
  "created_by_user_id",
];
const REQUIRED_CONSTRAINTS = [
  "orders_order_source_chk",
  "orders_creation_identity_chk",
  "orders_created_by_user_id_users_id_fk",
];
const REQUIRED_INDEXES = [
  "orders_staff_manual_request_uidx",
  "orders_source_created_idx",
];
const REQUIRED_FUNCTIONS = [
  "japan_underwear.derive_order_creation_source()",
  "japan_underwear.protect_order_customer_owner()",
  "japan_underwear.record_order_status_event()",
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
      to_regclass('japan_underwear.users') AS users,
      to_regclass('japan_underwear.order_status_events') AS order_status_events,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relationResult.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0011: ${missingRelations.join(", ")}.`);
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
  const missingMigrations = REQUIRED_MIGRATIONS.filter(
    (createdAt) => !applied.has(createdAt),
  );
  if (missingMigrations.length > 0) {
    throw new Error(`Thiếu migration nền trước 0011: ${missingMigrations.join(", ")}.`);
  }
}

async function applyMigrationStatements(migrationSql) {
  const statements = splitMigrationStatements(migrationSql);
  if (statements.length === 0) {
    throw new Error("Migration 0011 không có statement để chạy.");
  }

  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0011 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0011.`);
}

async function verifyAppliedState() {
  const columnResult = await client.query(
    `
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND table_name = 'orders'
        AND column_name = ANY($1::text[])
      ORDER BY column_name
    `,
    [REQUIRED_COLUMNS],
  );
  const columns = new Map(
    columnResult.rows.map((row) => [
      String(row.column_name),
      { nullable: String(row.is_nullable), defaultValue: row.column_default },
    ]),
  );
  const missingColumns = REQUIRED_COLUMNS.filter((name) => !columns.has(name));
  if (missingColumns.length > 0) {
    throw new Error(`Hậu kiểm 0011 thiếu column: ${missingColumns.join(", ")}.`);
  }
  if (
    columns.get("order_source")?.nullable !== "NO" ||
    columns.get("order_source")?.defaultValue != null
  ) {
    throw new Error("Hậu kiểm 0011 yêu cầu order_source NOT NULL và không có default tĩnh.");
  }

  const sourceCartResult = await client.query(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'orders'
      AND column_name = 'source_cart_id'
  `);
  if (sourceCartResult.rows[0]?.is_nullable !== "YES") {
    throw new Error("Hậu kiểm 0011 yêu cầu orders.source_cart_id nullable.");
  }

  const constraintResult = await client.query(
    `
      SELECT constraint_definition.conname AS constraint_name
      FROM pg_constraint AS constraint_definition
      JOIN pg_class AS table_definition
        ON table_definition.oid = constraint_definition.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = table_definition.relnamespace
      WHERE namespace.nspname = 'japan_underwear'
        AND table_definition.relname = 'orders'
        AND constraint_definition.conname = ANY($1::text[])
    `,
    [REQUIRED_CONSTRAINTS],
  );
  const constraints = new Set(
    constraintResult.rows.map((row) => String(row.constraint_name)),
  );
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(
    (name) => !constraints.has(name),
  );
  if (missingConstraints.length > 0) {
    throw new Error(`Hậu kiểm 0011 thiếu constraint: ${missingConstraints.join(", ")}.`);
  }

  const indexResult = await client.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'japan_underwear'
        AND tablename = 'orders'
        AND indexname = ANY($1::text[])
    `,
    [REQUIRED_INDEXES],
  );
  const indexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name));
  if (missingIndexes.length > 0) {
    throw new Error(`Hậu kiểm 0011 thiếu index: ${missingIndexes.join(", ")}.`);
  }

  const triggerResult = await client.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND event_object_table = 'orders'
      AND trigger_name = 'orders_creation_source_derive_trg'
  `);
  if (triggerResult.rowCount !== 1) {
    throw new Error("Hậu kiểm 0011 thiếu orders_creation_source_derive_trg.");
  }

  const invalidResult = await client.query(`
    SELECT count(*)::integer AS invalid_count
    FROM japan_underwear.orders
    WHERE NOT (
      (order_source = 'legacy_cart'
        AND source_cart_id IS NOT NULL
        AND customer_user_id IS NULL
        AND client_request_id IS NULL
        AND manual_request_id IS NULL
        AND created_by_user_id IS NULL)
      OR (order_source = 'customer_checkout'
        AND source_cart_id IS NOT NULL
        AND customer_user_id IS NOT NULL
        AND client_request_id IS NOT NULL
        AND manual_request_id IS NULL
        AND created_by_user_id IS NULL)
      OR (order_source = 'staff_manual'
        AND source_cart_id IS NULL
        AND client_request_id IS NULL
        AND manual_request_id IS NOT NULL
        AND created_by_user_id IS NOT NULL)
    )
  `);
  if (Number(invalidResult.rows[0]?.invalid_count ?? 0) !== 0) {
    throw new Error("Hậu kiểm 0011 phát hiện order creation identity không hợp lệ.");
  }

  for (const signature of REQUIRED_FUNCTIONS) {
    const functionResult = await client.query(
      "SELECT to_regprocedure($1) AS function_name",
      [signature],
    );
    if (!functionResult.rows[0]?.function_name) {
      throw new Error(`Hậu kiểm 0011 thiếu function ${signature}.`);
    }
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:manual-order-shared-service-migration'))",
    );

    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();

    console.log("  - Mở rộng order creation identity cho checkout và staff manual...");
    await applyMigrationStatements(migrationSql);

    console.log("  - Hậu kiểm column, constraint, index, trigger, function và dữ liệu...");
    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal cho 0011...");
    await reconcileJournal(migrationHash);

    await client.query("COMMIT");
    console.log("Manual order shared service migration OK.");
    console.log("Sources: legacy_cart | customer_checkout | staff_manual.");
    console.log("Manual order idempotency: created_by_user_id + manual_request_id.");
    console.log("Migration record 0011 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Manual order shared service migration failed: ${formatPgError(error)}`);
  process.exit(1);
});