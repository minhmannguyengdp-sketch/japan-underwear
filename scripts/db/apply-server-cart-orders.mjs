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
];
const SERVER_CART_MIGRATION_CREATED_AT = 1783860000000;
const MIGRATION_PATH = new URL("../../drizzle/0004_server_cart_orders.sql", import.meta.url);

const REQUIRED_TABLES = ["carts", "cart_items", "orders", "order_items"];
const REQUIRED_INDEXES = [
  "carts_token_uidx",
  "cart_items_cart_variant_color_uidx",
  "orders_order_code_uidx",
  "orders_source_cart_uidx",
  "order_items_order_variant_color_uidx",
];
const REQUIRED_CONSTRAINTS = [
  "carts_status_chk",
  "cart_items_quantity_chk",
  "cart_items_price_chk",
  "orders_status_chk",
  "orders_customer_name_nonempty_chk",
  "orders_customer_phone_nonempty_chk",
  "orders_subtotal_chk",
  "order_items_quantity_chk",
  "order_items_unit_price_chk",
  "order_items_line_total_chk",
];
const REQUIRED_TRIGGERS = [
  "cart_items_selection_same_product_trg",
  "order_items_selection_same_product_trg",
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
      to_regclass('japan_underwear.products') AS products,
      to_regclass('japan_underwear.product_variants') AS product_variants,
      to_regclass('japan_underwear.product_colors') AS product_colors,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const missingRelations = Object.entries(relationResult.rows[0])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    throw new Error(`Thiếu cấu trúc nền trước 0004: ${missingRelations.join(", ")}.`);
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
    throw new Error(`Thiếu migration nền trước 0004: ${missingMigrations.join(", ")}.`);
  }
}

async function applyMigrationStatements(migrationSql) {
  const statements = splitMigrationStatements(migrationSql);
  if (statements.length === 0) {
    throw new Error("Migration 0004 không có statement để chạy.");
  }

  for (const [index, statement] of statements.entries()) {
    try {
      await client.query(statement);
    } catch (error) {
      throw new Error(
        `Statement ${index + 1}/${statements.length} của migration 0004 thất bại: ${formatPgError(error)}`,
      );
    }
  }
  console.log(`  - Đã chạy ${statements.length} statement của migration 0004.`);
}

async function verifyAppliedState() {
  const tableResult = await client.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'japan_underwear'
        AND tablename = ANY($1::text[])
      ORDER BY tablename
    `,
    [REQUIRED_TABLES],
  );
  const tables = new Set(tableResult.rows.map((row) => String(row.tablename)));
  const missingTables = REQUIRED_TABLES.filter((tableName) => !tables.has(tableName));
  if (missingTables.length > 0) {
    throw new Error(`Hậu kiểm 0004 thiếu bảng: ${missingTables.join(", ")}.`);
  }

  const indexResult = await client.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'japan_underwear'
        AND indexname = ANY($1::text[])
      ORDER BY indexname
    `,
    [REQUIRED_INDEXES],
  );
  const indexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
  const missingIndexes = REQUIRED_INDEXES.filter((indexName) => !indexes.has(indexName));
  if (missingIndexes.length > 0) {
    throw new Error(`Hậu kiểm 0004 thiếu index: ${missingIndexes.join(", ")}.`);
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
        AND constraint_definition.conname = ANY($1::text[])
      ORDER BY constraint_definition.conname
    `,
    [REQUIRED_CONSTRAINTS],
  );
  const constraints = new Set(
    constraintResult.rows.map((row) => String(row.constraint_name)),
  );
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(
    (constraintName) => !constraints.has(constraintName),
  );
  if (missingConstraints.length > 0) {
    throw new Error(`Hậu kiểm 0004 thiếu constraint: ${missingConstraints.join(", ")}.`);
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
        AND NOT trigger_definition.tgisinternal
        AND trigger_definition.tgname = ANY($1::text[])
      ORDER BY trigger_definition.tgname
    `,
    [REQUIRED_TRIGGERS],
  );
  const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
  const missingTriggers = REQUIRED_TRIGGERS.filter((triggerName) => !triggers.has(triggerName));
  if (missingTriggers.length > 0) {
    throw new Error(`Hậu kiểm 0004 thiếu trigger: ${missingTriggers.join(", ")}.`);
  }

  const functionResult = await client.query(
    `SELECT to_regprocedure('japan_underwear.validate_order_selection_same_product()') AS function_name`,
  );
  if (!functionResult.rows[0]?.function_name) {
    throw new Error("Hậu kiểm 0004 thiếu function validate_order_selection_same_product().");
  }

  const columnResult = await client.query(`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND (
        (table_name = 'cart_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
        OR (table_name = 'order_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
      )
  `);
  const columns = new Map(
    columnResult.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]),
  );
  for (const column of [
    "cart_items.product_variant_id",
    "cart_items.color_id",
    "cart_items.quantity",
    "order_items.product_variant_id",
    "order_items.color_id",
    "order_items.quantity",
  ]) {
    if (columns.get(column) !== "NO") {
      throw new Error(`Hậu kiểm 0004: ${column} phải tồn tại và NOT NULL.`);
    }
  }
}

async function reconcileJournal(migrationHash) {
  await client.query(
    "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [SERVER_CART_MIGRATION_CREATED_AT],
  );
  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [migrationHash, SERVER_CART_MIGRATION_CREATED_AT],
  );
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto.createHash("sha256").update(migrationSql).digest("hex");

  await client.connect();
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:server-cart-orders-migration'))",
    );

    console.log("  - Kiểm tra schema và migration nền...");
    await assertRequiredState();

    console.log("  - Áp schema server cart và orders...");
    await applyMigrationStatements(migrationSql);

    console.log("  - Hậu kiểm bảng, index, constraint và trigger...");
    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal cho 0004...");
    await reconcileJournal(migrationHash);

    await client.query("COMMIT");
    console.log("Server cart and orders migration OK.");
    console.log("Cart item identity: cart + product_variant_id + color_id.");
    console.log("Order item identity: order + product_variant_id + color_id; quantity stored on row.");
    console.log("Migration record 0004 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Server cart/orders migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
