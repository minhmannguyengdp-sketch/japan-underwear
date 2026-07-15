import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const PREVIOUS_MIGRATION_CREATED_AT = 1783900000000;
const MIGRATION_CREATED_AT = 1783905000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0013_color_variant_availability.sql",
  import.meta.url,
);
const MAX_ATTEMPTS = 4;

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is required.");
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
  for (const key of ["code", "detail", "constraint", "table"]) {
    if (error[key]) details.push(`${key}=${error[key]}`);
  }
  return details.join(" | ");
}

function isRetryableConnectionError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "08000", "08001", "08003", "08006", "57P01"].includes(code) ||
    /timeout expired|connection terminated|connection closed|socket hang up/i.test(message)
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createClient() {
  return new Client({
    connectionString,
    ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
    query_timeout: 180_000,
    keepAlive: true,
  });
}

function splitMigrationStatements(sql) {
  return sql
    .split(/\s*-->\s*statement-breakpoint\s*/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function assertPreviousMigration(client) {
  const result = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM drizzle.__drizzle_migrations
      WHERE created_at = $1
    `,
    [PREVIOUS_MIGRATION_CREATED_AT],
  );
  if (Number(result.rows[0]?.count ?? 0) !== 1) {
    throw new Error(
      `Thiếu migration nền ${PREVIOUS_MIGRATION_CREATED_AT}; không áp dụng 0013.`,
    );
  }
}

async function verifyAppliedState(client) {
  const stateResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.product_color_variants') AS relation_table,
      to_regclass('japan_underwear.product_color_variants_color_variant_uidx') AS relation_identity_index,
      to_regclass('japan_underwear.product_color_variants_product_active_idx') AS product_active_index,
      to_regprocedure('japan_underwear.validate_product_color_variant_identity()') AS identity_function,
      to_regprocedure('japan_underwear.validate_orderable_color_variant_selection()') AS selection_function
  `);
  const state = stateResult.rows[0];
  for (const [key, value] of Object.entries(state)) {
    if (!value) throw new Error(`Hậu kiểm 0013 thiếu ${key}.`);
  }

  const columnResult = await client.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'product_color_variants'
      AND column_name IN ('product_id', 'color_id', 'variant_id', 'source', 'is_active')
  `);
  const columns = new Map(
    columnResult.rows.map((row) => [String(row.column_name), String(row.is_nullable)]),
  );
  for (const column of ["product_id", "color_id", "variant_id", "source", "is_active"]) {
    if (columns.get(column) !== "NO") {
      throw new Error(`Hậu kiểm 0013: ${column} phải NOT NULL.`);
    }
  }

  const triggerResult = await client.query(`
    SELECT event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND trigger_name IN (
        'product_color_variants_identity_trg',
        'cart_items_color_variant_selection_trg',
        'order_items_color_variant_selection_trg'
      )
  `);
  const triggers = new Set(
    triggerResult.rows.map((row) => `${row.event_object_table}:${row.trigger_name}`),
  );
  for (const trigger of [
    "product_color_variants:product_color_variants_identity_trg",
    "cart_items:cart_items_color_variant_selection_trg",
    "order_items:order_items_color_variant_selection_trg",
  ]) {
    if (!triggers.has(trigger)) throw new Error(`Hậu kiểm 0013 thiếu trigger ${trigger}.`);
  }
}

async function reconcileJournal(client, migrationHash) {
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

async function runAttempt(migrationSql, migrationHash) {
  const client = createClient();
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:color-variant-availability-migration'))",
    );

    await assertPreviousMigration(client);

    const journalResult = await client.query(
      "SELECT COUNT(*)::integer AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [MIGRATION_CREATED_AT],
    );
    const alreadyApplied = Number(journalResult.rows[0]?.count ?? 0) === 1;

    if (!alreadyApplied) {
      for (const statement of splitMigrationStatements(migrationSql)) {
        await client.query(statement);
      }
      await verifyAppliedState(client);
      await reconcileJournal(client, migrationHash);
    } else {
      await verifyAppliedState(client);
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return { alreadyApplied };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto
    .createHash("sha256")
    .update(migrationSql)
    .digest("hex");

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`Color–size/cup availability migration: kết nối lần ${attempt}/${MAX_ATTEMPTS}...`);
      const result = await runAttempt(migrationSql, migrationHash);
      console.log(
        result.alreadyApplied
          ? "Migration 0013 đã có và schema hậu kiểm hợp lệ."
          : "Color–size/cup availability migration OK.",
      );
      console.log("Authoritative relation: product + color + size/cup.");
      console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`Kết nối PostgreSQL chưa sẵn sàng: ${formatPgError(error)}`);
      await sleep(attempt * 2_000);
    }
  }

  throw lastError;
}

main().catch((error) => {
  console.error(`Color–size/cup availability migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
