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
];
const MIGRATION_CREATED_AT = 1783875000000;
const MIGRATION_PATH = new URL("../../drizzle/0007_auth_foundation.sql", import.meta.url);
const REQUIRED_TABLES = [
  "users",
  "auth_accounts",
  "auth_sessions",
  "user_roles",
  "auth_audit_events",
];
const REQUIRED_INDEXES = [
  "users_email_lower_uidx",
  "auth_accounts_user_idx",
  "auth_sessions_user_idx",
  "auth_sessions_expires_idx",
  "user_roles_role_idx",
  "auth_audit_events_target_created_idx",
];
const REQUIRED_TRIGGERS = [
  "users_normalize_trg",
  "users_default_customer_role_trg",
  "users_status_guard_trg",
  "user_roles_audit_trg",
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
    throw new Error(`Thiếu cấu trúc nền trước 0007: ${missingRelations.join(", ")}.`);
  }

  const migrationResult = await client.query(
    `SELECT created_at FROM drizzle.__drizzle_migrations WHERE created_at = ANY($1::bigint[])`,
    [REQUIRED_MIGRATIONS],
  );
  const applied = new Set(migrationResult.rows.map((row) => Number(row.created_at)));
  const missing = REQUIRED_MIGRATIONS.filter((createdAt) => !applied.has(createdAt));
  if (missing.length > 0) {
    throw new Error(`Thiếu migration nền trước 0007: ${missing.join(", ")}.`);
  }
}

async function applyMigrationStatements(migrationSql) {
  const statements = splitMigrationStatements(migrationSql);
  if (statements.length === 0) throw new Error("Migration 0007 không có statement để chạy.");

  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0007 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0007.`);
}

async function verifyAppliedState() {
  const tableResult = await client.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'japan_underwear'
        AND tablename = ANY($1::text[])
    `,
    [REQUIRED_TABLES],
  );
  const tables = new Set(tableResult.rows.map((row) => String(row.tablename)));
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length > 0) {
    throw new Error(`Hậu kiểm 0007 thiếu bảng: ${missingTables.join(", ")}.`);
  }

  const indexResult = await client.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'japan_underwear'
        AND indexname = ANY($1::text[])
    `,
    [REQUIRED_INDEXES],
  );
  const indexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name));
  if (missingIndexes.length > 0) {
    throw new Error(`Hậu kiểm 0007 thiếu index: ${missingIndexes.join(", ")}.`);
  }

  const triggerResult = await client.query(
    `
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'japan_underwear'
        AND trigger_name = ANY($1::text[])
    `,
    [REQUIRED_TRIGGERS],
  );
  const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
  const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggers.has(name));
  if (missingTriggers.length > 0) {
    throw new Error(`Hậu kiểm 0007 thiếu trigger: ${missingTriggers.join(", ")}.`);
  }

  const columnResult = await client.query(`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND (
        (table_name = 'users' AND column_name IN ('id', 'status'))
        OR (table_name = 'auth_sessions' AND column_name IN ('session_token', 'user_id', 'expires'))
        OR (table_name = 'auth_accounts' AND column_name IN ('user_id', 'provider', 'provider_account_id'))
        OR (table_name = 'user_roles' AND column_name IN ('user_id', 'role'))
      )
  `);
  for (const row of columnResult.rows) {
    if (row.is_nullable !== "NO") {
      throw new Error(`Hậu kiểm 0007: ${row.table_name}.${row.column_name} phải NOT NULL.`);
    }
  }
  if (columnResult.rowCount !== 10) {
    throw new Error(`Hậu kiểm 0007 thiếu cột identity bắt buộc; đọc được ${columnResult.rowCount}/10.`);
  }
}

async function reconcileJournal(migrationHash) {
  await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [
    MIGRATION_CREATED_AT,
  ]);
  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:auth-foundation-migration'))",
    );
    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();
    console.log("  - Áp identity, account, session, role và audit...");
    await applyMigrationStatements(migrationSql);
    console.log("  - Hậu kiểm bảng, index, trigger và identity columns...");
    await verifyAppliedState();
    console.log("  - Reconcile Drizzle migration journal cho 0007...");
    await reconcileJournal(migrationHash);
    await client.query("COMMIT");

    console.log("Auth foundation migration OK.");
    console.log("Internal user identity: UUID.");
    console.log("Session strategy: PostgreSQL database sessions.");
    console.log("Roles: customer | sales | admin.");
    console.log("Blocked users: sessions revoked by database trigger.");
    console.log("Migration record 0007 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Auth foundation migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
