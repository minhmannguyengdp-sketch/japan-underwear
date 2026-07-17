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
  1783895000000,
];
const MIGRATION_CREATED_AT = 1783900000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0012_catalog_price_management.sql",
  import.meta.url,
);

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
  const relationResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products,
      to_regclass('japan_underwear.product_colors') AS product_colors,
      to_regclass('japan_underwear.product_variants') AS product_variants,
      to_regclass('japan_underwear.users') AS users,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relationResult.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0012: ${missingRelations.join(", ")}.`);
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
  const missingMigrations = REQUIRED_MIGRATIONS.filter((value) => !applied.has(value));
  if (missingMigrations.length > 0) {
    throw new Error(`Thiếu migration nền trước 0012: ${missingMigrations.join(", ")}.`);
  }
}

async function applyMigrationStatements(sql) {
  const statements = splitMigrationStatements(sql);
  if (statements.length === 0) throw new Error("Migration 0012 không có statement để chạy.");
  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0012 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0012.`);
}

async function verifyAppliedState() {
  const columnResult = await client.query(`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND (
        (table_name = 'products' AND column_name IN ('row_version', 'updated_at'))
        OR (table_name = 'product_colors' AND column_name IN ('row_version', 'updated_at'))
        OR (table_name = 'product_variants' AND column_name IN ('row_version', 'updated_at'))
      )
  `);
  const columns = new Map(
    columnResult.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      String(row.is_nullable),
    ]),
  );
  for (const table of ["products", "product_colors", "product_variants"]) {
    for (const column of ["row_version", "updated_at"]) {
      if (columns.get(`${table}.${column}`) !== "NO") {
        throw new Error(`Hậu kiểm 0012 yêu cầu ${table}.${column} NOT NULL.`);
      }
    }
  }

  const auditTableResult = await client.query(
    "SELECT to_regclass('japan_underwear.catalog_change_audit') AS table_name",
  );
  if (!auditTableResult.rows[0]?.table_name) {
    throw new Error("Hậu kiểm 0012 thiếu catalog_change_audit.");
  }

  const indexResult = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'japan_underwear'
      AND indexname IN (
        'catalog_change_audit_product_created_idx',
        'catalog_change_audit_actor_created_idx',
        'catalog_change_audit_entity_created_idx',
        'catalog_change_audit_request_idx'
      )
  `);
  if (indexResult.rowCount !== 4) {
    throw new Error("Hậu kiểm 0012 thiếu index catalog audit.");
  }

  const triggerResult = await client.query(`
    SELECT event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND trigger_name IN (
        'products_catalog_version_trg',
        'product_colors_catalog_version_trg',
        'product_variants_catalog_version_trg',
        'products_catalog_audit_trg',
        'product_colors_catalog_audit_trg',
        'product_variants_catalog_audit_trg'
      )
  `);
  if (triggerResult.rowCount !== 6) {
    throw new Error("Hậu kiểm 0012 thiếu trigger version/audit catalog.");
  }

  for (const signature of [
    "japan_underwear.bump_catalog_row_version()",
    "japan_underwear.record_catalog_change_audit()",
  ]) {
    const functionResult = await client.query(
      "SELECT to_regprocedure($1) AS function_name",
      [signature],
    );
    if (!functionResult.rows[0]?.function_name) {
      throw new Error(`Hậu kiểm 0012 thiếu function ${signature}.`);
    }
  }

  const invalidVersionResult = await client.query(`
    SELECT
      (SELECT count(*) FROM japan_underwear.products WHERE row_version < 1) +
      (SELECT count(*) FROM japan_underwear.product_colors WHERE row_version < 1) +
      (SELECT count(*) FROM japan_underwear.product_variants WHERE row_version < 1)
      AS invalid_count
  `);
  if (Number(invalidVersionResult.rows[0]?.invalid_count ?? 0) !== 0) {
    throw new Error("Hậu kiểm 0012 phát hiện row_version không hợp lệ.");
  }
}

async function reconcileJournal(hash) {
  await client.query(
    "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [MIGRATION_CREATED_AT],
  );
  await client.query(
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
    [hash, MIGRATION_CREATED_AT],
  );
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto.createHash("sha256").update(migrationSql).digest("hex");

  await client.connect();
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:catalog-price-management-migration'))",
    );
    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();
    console.log("  - Thêm optimistic concurrency và catalog audit...");
    await applyMigrationStatements(migrationSql);
    console.log("  - Hậu kiểm column, table, index, trigger, function và dữ liệu...");
    await verifyAppliedState();
    console.log("  - Reconcile Drizzle migration journal cho 0012...");
    await reconcileJournal(migrationHash);
    await client.query("COMMIT");
    console.log("Catalog price management migration OK.");
    console.log("Migration record 0012 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Catalog price management migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
