import { randomUUID } from "node:crypto";
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
const REQUIRED_CONSTRAINTS = [
  "order_status_events_status_chk",
  "order_status_events_actor_source_nonempty_chk",
  "order_status_events_actor_label_nonempty_chk",
  "order_status_events_reason_nonempty_chk",
  "order_status_events_cancel_reason_chk",
  "order_status_events_idempotency_nonempty_chk",
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

function assertRuntime(condition, message) {
  if (!condition) {
    throw new Error(`Order status runtime verification failed: ${message}`);
  }
}

async function verifyRuntimeGuards() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const orderCode = `TT-20991231-${suffix}`;
  const idempotencyKey = `db-verify-confirm-${suffix}`;
  const terminalKey = `db-verify-terminal-${suffix}`;
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const cartResult = await client.query(`
      INSERT INTO japan_underwear.carts (status)
      VALUES ('active')
      RETURNING id
    `);
    const cartId = cartResult.rows[0]?.id;
    assertRuntime(Boolean(cartId), "failed to create rollback-only cart fixture");

    const orderResult = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code,
          source_cart_id,
          status,
          customer_name,
          customer_phone,
          subtotal,
          currency
        )
        VALUES ($1, $2, 'submitted', 'DB verify', '0000000000', 0, 'VND')
        RETURNING id
      `,
      [orderCode, cartId],
    );
    const orderId = orderResult.rows[0]?.id;
    assertRuntime(Boolean(orderId), "failed to create rollback-only order fixture");

    const transitionSql = `
      SELECT *
      FROM japan_underwear.transition_order_status(
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        $6::text
      )
    `;

    const firstResult = await client.query(transitionSql, [
      orderCode,
      "confirmed",
      "db_verify",
      "verify-order-status-lifecycle",
      null,
      idempotencyKey,
    ]);
    const first = firstResult.rows[0];
    assertRuntime(first?.changed === true, "first transition must change the order");
    assertRuntime(first?.idempotent === false, "first transition must not be a replay");
    assertRuntime(first?.current_status === "confirmed", "first transition must confirm the order");
    assertRuntime(Boolean(first?.event_id), "first transition must return an audit event");

    const replayResult = await client.query(transitionSql, [
      orderCode,
      "confirmed",
      "db_verify",
      "verify-order-status-lifecycle",
      null,
      idempotencyKey,
    ]);
    const replay = replayResult.rows[0];
    assertRuntime(replay?.changed === false, "idempotency replay must not change the order");
    assertRuntime(replay?.idempotent === true, "idempotency replay must be marked idempotent");
    assertRuntime(replay?.event_id === first.event_id, "idempotency replay must return the original event");

    const replayEventResult = await client.query(
      `
        SELECT count(*)::integer AS event_count
        FROM japan_underwear.order_status_events
        WHERE order_id = $1
          AND idempotency_key = $2
          AND from_status = 'submitted'
          AND to_status = 'confirmed'
      `,
      [orderId, idempotencyKey],
    );
    assertRuntime(
      Number(replayEventResult.rows[0]?.event_count ?? 0) === 1,
      "idempotency replay must leave exactly one transition event",
    );

    await client.query("SAVEPOINT terminal_guard_check");
    let terminalError;
    try {
      await client.query(transitionSql, [
        orderCode,
        "cancelled",
        "db_verify",
        "verify-order-status-lifecycle",
        "Terminal guard verification",
        terminalKey,
      ]);
    } catch (error) {
      terminalError = error;
      await client.query("ROLLBACK TO SAVEPOINT terminal_guard_check");
    }
    await client.query("RELEASE SAVEPOINT terminal_guard_check");

    assertRuntime(Boolean(terminalError), "confirmed -> cancelled must be rejected");
    assertRuntime(terminalError?.code === "23514", "terminal transition must use SQLSTATE 23514");

    const terminalStateResult = await client.query(
      `
        SELECT
          orders.status,
          count(events.id)::integer AS cancelled_event_count
        FROM japan_underwear.orders AS orders
        LEFT JOIN japan_underwear.order_status_events AS events
          ON events.order_id = orders.id
         AND events.to_status = 'cancelled'
        WHERE orders.id = $1
        GROUP BY orders.status
      `,
      [orderId],
    );
    const terminalState = terminalStateResult.rows[0];
    assertRuntime(terminalState?.status === "confirmed", "terminal rejection must preserve confirmed status");
    assertRuntime(
      Number(terminalState?.cancelled_event_count ?? 0) === 0,
      "terminal rejection must not create a cancelled event",
    );

    return { orderCode, eventId: first.event_id };
  } finally {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
  }
}

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

    const constraintResult = await client.query(
      `
        SELECT constraint_definition.conname AS constraint_name
        FROM pg_constraint AS constraint_definition
        JOIN pg_class AS table_definition
          ON table_definition.oid = constraint_definition.conrelid
        JOIN pg_namespace AS namespace
          ON namespace.oid = table_definition.relnamespace
        WHERE namespace.nspname = 'japan_underwear'
          AND table_definition.relname = 'order_status_events'
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
      throw new Error(`Missing order status constraints: ${missingConstraints.join(", ")}.`);
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
      OR (to_status = 'cancelled' AND reason IS NULL)
    `);
    if (Number(invalidEventResult.rows[0]?.invalid_count ?? 0) !== 0) {
      throw new Error("Invalid order status transition event found.");
    }

    await verifyRuntimeGuards();

    console.log("Order status lifecycle verification OK.");
    console.log("Allowed transitions: submitted -> confirmed | cancelled.");
    console.log("Terminal statuses: confirmed, cancelled.");
    console.log("Cancellation reason: required by DB trigger and audit constraint.");
    console.log("Runtime idempotency: replay returns the original event without duplication.");
    console.log("Runtime terminal guard: confirmed -> cancelled is rejected without side effects.");
    console.log("Runtime fixtures: executed inside a transaction and rolled back.");
    console.log(`Audit coverage: ${orderCount} order(s), 0 missing history.`);
    console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
