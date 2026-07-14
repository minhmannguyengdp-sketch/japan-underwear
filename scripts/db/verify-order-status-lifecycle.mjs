import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783890000000;
const REQUIRED_INDEXES = [
  "order_status_events_order_created_idx",
  "order_status_events_order_idempotency_uidx",
];
const REQUIRED_CONSTRAINTS = [
  "orders_status_chk",
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
const TRANSITION_SQL = `
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

function fixtureOrderCode() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `TT-20991231-${suffix}`;
}

async function createOrderFixture(label) {
  const cartResult = await client.query(`
    INSERT INTO japan_underwear.carts (status)
    VALUES ('active')
    RETURNING id
  `);
  const cartId = cartResult.rows[0]?.id;
  assertRuntime(Boolean(cartId), `${label}: failed to create cart fixture`);

  const orderCode = fixtureOrderCode();
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
      VALUES ($1, $2, 'submitted', $3, '0000000000', 0, 'VND')
      RETURNING id
    `,
    [orderCode, cartId, `DB verify ${label}`],
  );
  const orderId = orderResult.rows[0]?.id;
  assertRuntime(Boolean(orderId), `${label}: failed to create order fixture`);
  return { orderId, orderCode };
}

async function transition(orderCode, targetStatus, reason, idempotencyKey) {
  const result = await client.query(TRANSITION_SQL, [
    orderCode,
    targetStatus,
    "db_verify",
    "verify-order-status-lifecycle",
    reason,
    idempotencyKey,
  ]);
  return result.rows[0];
}

let savepointCounter = 0;
async function expectSqlState(label, expectedCode, callback) {
  savepointCounter += 1;
  const savepoint = `status_guard_${savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caughtError;
  try {
    await callback();
  } catch (error) {
    caughtError = error;
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);

  assertRuntime(Boolean(caughtError), `${label}: expected SQLSTATE ${expectedCode}`);
  assertRuntime(
    caughtError?.code === expectedCode,
    `${label}: expected SQLSTATE ${expectedCode}, received ${caughtError?.code ?? "none"}`,
  );
}

async function readOrderState(orderId) {
  const result = await client.query(
    `
      SELECT status
      FROM japan_underwear.orders
      WHERE id = $1::uuid
    `,
    [orderId],
  );
  return result.rows[0]?.status;
}

async function countTransitionEvents(orderId) {
  const result = await client.query(
    `
      SELECT count(*)::integer AS event_count
      FROM japan_underwear.order_status_events
      WHERE order_id = $1::uuid
    `,
    [orderId],
  );
  return Number(result.rows[0]?.event_count ?? 0);
}

async function verifyRuntimeGuards() {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const fullPath = await createOrderFixture("full-path");
    const confirmedKey = `db-verify-confirm-${randomUUID()}`;
    const processingKey = `db-verify-processing-${randomUUID()}`;
    const completedKey = `db-verify-completed-${randomUUID()}`;

    const confirmed = await transition(
      fullPath.orderCode,
      "confirmed",
      null,
      confirmedKey,
    );
    assertRuntime(confirmed?.changed === true, "submitted -> confirmed must change the order");
    assertRuntime(confirmed?.previous_status === "submitted", "confirmed event must start at submitted");
    assertRuntime(confirmed?.current_status === "confirmed", "confirmed event must end at confirmed");

    const processing = await transition(
      fullPath.orderCode,
      "processing",
      null,
      processingKey,
    );
    assertRuntime(processing?.changed === true, "confirmed -> processing must change the order");
    assertRuntime(processing?.previous_status === "confirmed", "processing event must start at confirmed");
    assertRuntime(processing?.current_status === "processing", "processing event must end at processing");
    assertRuntime(Boolean(processing?.event_id), "processing transition must return its audit event");

    const processingReplay = await transition(
      fullPath.orderCode,
      "processing",
      null,
      processingKey,
    );
    assertRuntime(processingReplay?.changed === false, "idempotency replay must not change the order");
    assertRuntime(processingReplay?.idempotent === true, "idempotency replay must be marked idempotent");
    assertRuntime(
      processingReplay?.event_id === processing.event_id,
      "idempotency replay must return the original processing event",
    );

    const replayEventResult = await client.query(
      `
        SELECT count(*)::integer AS event_count
        FROM japan_underwear.order_status_events
        WHERE order_id = $1::uuid
          AND idempotency_key = $2
          AND from_status = 'confirmed'
          AND to_status = 'processing'
      `,
      [fullPath.orderId, processingKey],
    );
    assertRuntime(
      Number(replayEventResult.rows[0]?.event_count ?? 0) === 1,
      "idempotency replay must leave exactly one processing event",
    );

    const completed = await transition(
      fullPath.orderCode,
      "completed",
      null,
      completedKey,
    );
    assertRuntime(completed?.changed === true, "processing -> completed must change the order");
    assertRuntime(completed?.previous_status === "processing", "completed event must start at processing");
    assertRuntime(completed?.current_status === "completed", "completed event must end at completed");
    assertRuntime(
      (await countTransitionEvents(fullPath.orderId)) === 4,
      "full lifecycle must contain baseline plus exactly three transition events",
    );

    const auditResult = await client.query(
      `
        SELECT actor_source, actor_label, reason
        FROM japan_underwear.order_status_events
        WHERE id = $1::uuid
      `,
      [processing.event_id],
    );
    const audit = auditResult.rows[0];
    assertRuntime(audit?.actor_source === "db_verify", "audit must preserve actor source");
    assertRuntime(
      audit?.actor_label === "verify-order-status-lifecycle",
      "audit must preserve actor label",
    );
    assertRuntime(audit?.reason == null, "non-cancellation audit reason must remain null");

    await expectSqlState("idempotency target conflict", "23505", async () => {
      await transition(fullPath.orderCode, "completed", null, processingKey);
    });
    await expectSqlState("completed is terminal", "23514", async () => {
      await transition(
        fullPath.orderCode,
        "cancelled",
        "Không được hủy đơn hoàn tất",
        `db-verify-completed-terminal-${randomUUID()}`,
      );
    });
    assertRuntime(
      (await readOrderState(fullPath.orderId)) === "completed",
      "terminal rejection must preserve completed status",
    );

    const submittedJump = await createOrderFixture("submitted-jump");
    await expectSqlState("submitted -> processing", "23514", async () => {
      await transition(
        submittedJump.orderCode,
        "processing",
        null,
        `db-verify-submitted-jump-${randomUUID()}`,
      );
    });
    assertRuntime(
      (await countTransitionEvents(submittedJump.orderId)) === 1,
      "rejected submitted jump must not create an audit event",
    );

    const confirmedJump = await createOrderFixture("confirmed-jump");
    await transition(
      confirmedJump.orderCode,
      "confirmed",
      null,
      `db-verify-confirmed-jump-setup-${randomUUID()}`,
    );
    await expectSqlState("confirmed -> completed", "23514", async () => {
      await transition(
        confirmedJump.orderCode,
        "completed",
        null,
        `db-verify-confirmed-jump-${randomUUID()}`,
      );
    });
    assertRuntime(
      (await readOrderState(confirmedJump.orderId)) === "confirmed",
      "rejected confirmed jump must preserve confirmed status",
    );

    const processingCancel = await createOrderFixture("processing-cancel");
    await transition(
      processingCancel.orderCode,
      "confirmed",
      null,
      `db-verify-processing-confirm-${randomUUID()}`,
    );
    await transition(
      processingCancel.orderCode,
      "processing",
      null,
      `db-verify-processing-start-${randomUUID()}`,
    );
    await expectSqlState("processing -> cancelled", "23514", async () => {
      await transition(
        processingCancel.orderCode,
        "cancelled",
        "Không được hủy khi đang xử lý",
        `db-verify-processing-cancel-${randomUUID()}`,
      );
    });
    assertRuntime(
      (await readOrderState(processingCancel.orderId)) === "processing",
      "rejected processing cancellation must preserve processing status",
    );

    const missingReason = await createOrderFixture("missing-cancel-reason");
    await expectSqlState("cancellation reason function guard", "22023", async () => {
      await transition(
        missingReason.orderCode,
        "cancelled",
        null,
        `db-verify-missing-reason-${randomUUID()}`,
      );
    });
    await expectSqlState("cancellation reason trigger guard", "23514", async () => {
      await client.query(
        `
          UPDATE japan_underwear.orders
          SET status = 'cancelled', updated_at = now()
          WHERE id = $1::uuid
        `,
        [missingReason.orderId],
      );
    });
    assertRuntime(
      (await countTransitionEvents(missingReason.orderId)) === 1,
      "missing cancellation reason must not create an event",
    );

    const submittedCancel = await createOrderFixture("submitted-cancel");
    const submittedCancellation = await transition(
      submittedCancel.orderCode,
      "cancelled",
      "Khách yêu cầu hủy trước khi xác nhận",
      `db-verify-submitted-cancel-${randomUUID()}`,
    );
    assertRuntime(
      submittedCancellation?.previous_status === "submitted" &&
        submittedCancellation?.current_status === "cancelled",
      "submitted cancellation must succeed",
    );

    const confirmedCancel = await createOrderFixture("confirmed-cancel");
    await transition(
      confirmedCancel.orderCode,
      "confirmed",
      null,
      `db-verify-confirmed-cancel-setup-${randomUUID()}`,
    );
    const confirmedCancellation = await transition(
      confirmedCancel.orderCode,
      "cancelled",
      "Khách yêu cầu hủy sau khi xác nhận",
      `db-verify-confirmed-cancel-${randomUUID()}`,
    );
    assertRuntime(
      confirmedCancellation?.previous_status === "confirmed" &&
        confirmedCancellation?.current_status === "cancelled",
      "confirmed cancellation must succeed",
    );
    await expectSqlState("cancelled is terminal", "23514", async () => {
      await transition(
        confirmedCancel.orderCode,
        "processing",
        null,
        `db-verify-cancelled-terminal-${randomUUID()}`,
      );
    });

    return { fullPathOrderCode: fullPath.orderCode };
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

    const functionDefinitionResult = await client.query(
      `
        SELECT pg_get_functiondef(
          to_regprocedure('japan_underwear.transition_order_status(text,text,text,text,text,text)')
        ) AS definition
      `,
    );
    const functionDefinition = String(functionDefinitionResult.rows[0]?.definition ?? "");
    if (!functionDefinition.includes("FOR UPDATE")) {
      throw new Error("transition_order_status must lock the order row FOR UPDATE.");
    }
    if (!functionDefinition.includes("status = resolved_current_status")) {
      throw new Error("transition_order_status must keep a compare-and-set status predicate.");
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

    const invalidOrderResult = await client.query(`
      SELECT count(*)::integer AS invalid_count
      FROM japan_underwear.orders
      WHERE status NOT IN ('submitted', 'confirmed', 'processing', 'completed', 'cancelled')
    `);
    if (Number(invalidOrderResult.rows[0]?.invalid_count ?? 0) !== 0) {
      throw new Error("Invalid order status found.");
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
      throw new Error("Invalid order status transition event found.");
    }

    await verifyRuntimeGuards();

    console.log("Order status lifecycle verification OK.");
    console.log("Allowed path: submitted -> confirmed -> processing -> completed.");
    console.log("Cancellation: submitted | confirmed -> cancelled, reason required.");
    console.log("Terminal statuses: completed, cancelled.");
    console.log("Runtime idempotency: replay returns the original event without duplication.");
    console.log("Runtime invalid jumps and terminal transitions: rejected without audit side effects.");
    console.log("Concurrency guard: FOR UPDATE plus compare-and-set status predicate.");
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
