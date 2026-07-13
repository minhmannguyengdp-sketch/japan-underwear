import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783865000000;
const REQUIRED_INDEXES = [
  "order_status_events_order_created_idx",
  "order_status_events_order_idempotency_uidx",
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

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

async function main() {
  await client.connect();
  try {
    const tableResult = await client.query(
      "SELECT to_regclass('japan_underwear.order_status_events') AS table_name",
    );
    if (!tableResult.rows[0]?.table_name) {
      throw new Error("Missing japan_underwear.order_status_events.");
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
      throw new Error(`Missing order status indexes: ${missingIndexes.join(", ")}.`);
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
      `,
      [REQUIRED_TRIGGERS],
    );
    const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
    const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggers.has(name));
    if (missingTriggers.length > 0) {
      throw new Error(`Missing order status triggers: ${missingTriggers.join(", ")}.`);
    }

    for (const signature of REQUIRED_FUNCTIONS) {
      const functionResult = await client.query(
        "SELECT to_regprocedure($1) AS function_name",
        [signature],
      );
      if (!functionResult.rows[0]?.function_name) {
        throw new Error(`Missing order status function: ${signature}.`);
      }
    }

    const migrationResult = await client.query(
      "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [MIGRATION_CREATED_AT],
    );
    if (migrationResult.rowCount !== 1) {
      throw new Error(`Missing Drizzle migration record ${MIGRATION_CREATED_AT}.`);
    }

    const coverageResult = await client.query(`
      SELECT
        count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM japan_underwear.order_status_events AS event
            WHERE event.order_id = orders.id
          )
        )::integer AS missing_orders,
        count(*)::integer AS order_count
      FROM japan_underwear.orders AS orders
    `);
    const missingOrders = Number(coverageResult.rows[0]?.missing_orders ?? 0);
    const orderCount = Number(coverageResult.rows[0]?.order_count ?? 0);
    if (missingOrders !== 0) {
      throw new Error(`${missingOrders} order(s) do not have status audit history.`);
    }

    const invalidEventResult = await client.query(`
      SELECT count(*)::integer AS invalid_count
      FROM japan_underwear.order_status_events
      WHERE NOT (
        (from_status IS NULL AND to_status IN ('submitted', 'confirmed', 'cancelled'))
        OR (from_status = 'submitted' AND to_status IN ('confirmed', 'cancelled'))
      )
    `);
    if (Number(invalidEventResult.rows[0]?.invalid_count ?? 0) !== 0) {
      throw new Error("Invalid order status transition event found.");
    }

    console.log("Order status lifecycle verification OK.");
    console.log("Allowed transitions: submitted -> confirmed | cancelled.");
    console.log("Terminal statuses: confirmed, cancelled.");
    console.log(`Audit coverage: ${orderCount} order(s), 0 missing history.`);
    console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
    console.log("Admin UI/API: intentionally not implemented before STOP GATE #2.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
