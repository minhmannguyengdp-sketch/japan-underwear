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
];
const MIGRATION_CREATED_AT = 1783890000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0010_order_processing_lifecycle.sql",
  import.meta.url,
);
const REQUIRED_CONSTRAINTS = [
  "orders_status_chk",
  "order_status_events_status_chk",
  "order_status_events_cancel_reason_chk",
];
const REQUIRED_TRIGGERS = [
  "orders_status_transition_guard_trg",
  "orders_status_audit_trg",
];
const REQUIRED_FUNCTIONS = [
  "japan_underwear.validate_order_status_transition()",
  "japan_underwear.record_order_status_event()",
  "japan_underwear.transition_order_status(text,text,text,text,text,text)",
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
    throw new Error(`Thiếu cấu trúc nền trước 0010: ${missingRelations.join(", ")}.`);
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
    throw new Error(`Thiếu migration nền trước 0010: ${missingMigrations.join(", ")}.`);
  }
}

async function applyMigrationStatements(migrationSql) {
  const statements = splitMigrationStatements(migrationSql);
  if (statements.length === 0) {
    throw new Error("Migration 0010 không có statement để chạy.");
  }

  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0010 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0010.`);
}

async function verifyAppliedState() {
  const constraintResult = await client.query(
    `
      SELECT constraint_definition.conname AS constraint_name
      FROM pg_constraint AS constraint_definition
      JOIN pg_class AS table_definition
        ON table_definition.oid = constraint_definition.conrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = table_definition.relnamespace
      WHERE namespace.nspname = 'japan_underwear'
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
    throw new Error(`Hậu kiểm 0010 thiếu constraint: ${missingConstraints.join(", ")}.`);
  }

  const triggerResult = await client.query(
    `
      SELECT trigger_definition.tgname AS trigger_name
      FROM pg_trigger AS trigger_definition
      JOIN pg_class AS table_definition
        ON table_definition.oid = trigger_definition.tgrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = table_definition.relnamespace
      WHERE namespace.nspname = 'japan_underwear'
        AND table_definition.relname = 'orders'
        AND NOT trigger_definition.tgisinternal
        AND trigger_definition.tgname = ANY($1::text[])
      ORDER BY trigger_definition.tgname
    `,
    [REQUIRED_TRIGGERS],
  );
  const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
  const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggers.has(name));
  if (missingTriggers.length > 0) {
    throw new Error(`Hậu kiểm 0010 thiếu trigger: ${missingTriggers.join(", ")}.`);
  }

  for (const signature of REQUIRED_FUNCTIONS) {
    const functionResult = await client.query(
      "SELECT to_regprocedure($1) AS function_name",
      [signature],
    );
    if (!functionResult.rows[0]?.function_name) {
      throw new Error(`Hậu kiểm 0010 thiếu function ${signature}.`);
    }
  }

  const invalidOrderResult = await client.query(`
    SELECT count(*)::integer AS invalid_count
    FROM japan_underwear.orders
    WHERE status NOT IN ('submitted', 'confirmed', 'processing', 'completed', 'cancelled')
  `);
  if (Number(invalidOrderResult.rows[0]?.invalid_count ?? 0) !== 0) {
    throw new Error("Hậu kiểm 0010 phát hiện order status ngoài lifecycle.");
  }

  const invalidEventResult = await client.query(`
    SELECT count(*)::integer AS invalid_count
    FROM japan_underwear.order_status_events
    WHERE NOT (
      (from_status IS NULL AND to_status IN (
        'submitted', 'confirmed', 'processing', 'completed', 'cancelled'
      ))
      OR (from_status = 'submitted' AND to_status IN ('confirmed', 'cancelled'))
      OR (from_status = 'confirmed' AND to_status IN ('processing', 'cancelled'))
      OR (from_status = 'processing' AND to_status = 'completed')
    )
    OR (to_status = 'cancelled' AND reason IS NULL)
  `);
  if (Number(invalidEventResult.rows[0]?.invalid_count ?? 0) !== 0) {
    throw new Error("Hậu kiểm 0010 phát hiện status event trái lifecycle.");
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:order-processing-lifecycle-migration'))",
    );

    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();

    console.log("  - Mở rộng lifecycle đơn hàng và giữ trigger làm nguồn luật duy nhất...");
    await applyMigrationStatements(migrationSql);

    console.log("  - Hậu kiểm constraint, trigger, function và dữ liệu hiện có...");
    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal cho 0010...");
    await reconcileJournal(migrationHash);

    await client.query("COMMIT");
    console.log("Order processing lifecycle migration OK.");
    console.log("Allowed transitions: submitted -> confirmed -> processing -> completed.");
    console.log("Cancellation: submitted | confirmed -> cancelled, reason required.");
    console.log("Terminal statuses: completed, cancelled.");
    console.log("Migration record 0010 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Order processing lifecycle migration failed: ${formatPgError(error)}`);
  process.exit(1);
});