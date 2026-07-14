import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783885000000;
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
});

async function expectPgError(label, code, work) {
  const savepoint = `verify_${label.replaceAll(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await work();
  } catch (error) {
    rejected = error?.code === code;
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  if (!rejected) throw new Error(`${label} was not rejected with PostgreSQL code ${code}.`);
}

async function verifyRuntime() {
  await client.query("BEGIN");
  try {
    const suffix = randomUUID();
    const users = await client.query(
      `
        INSERT INTO japan_underwear.users (email, name)
        VALUES
          ($1, 'Phase 6 verifier A'),
          ($2, 'Phase 6 verifier B')
        RETURNING id
      `,
      [`phase6-a-${suffix}@example.invalid`, `phase6-b-${suffix}@example.invalid`],
    );
    const [userA, userB] = users.rows;

    const profiles = await client.query(
      `
        INSERT INTO japan_underwear.customer_profiles (
          user_id, store_name, contact_name, phone, delivery_address
        ) VALUES
          ($1::uuid, '  Store A  ', '  Contact A  ', ' 0900000001 ', ' Address A '),
          ($2::uuid, 'Store B', 'Contact B', '0900000002', 'Address B')
        RETURNING user_id, store_name, contact_name, phone, delivery_address
      `,
      [userA.id, userB.id],
    );
    const normalizedA = profiles.rows.find((row) => String(row.user_id) === String(userA.id));
    if (
      normalizedA?.store_name !== "Store A" ||
      normalizedA?.contact_name !== "Contact A" ||
      normalizedA?.phone !== "0900000001" ||
      normalizedA?.delivery_address !== "Address A"
    ) {
      throw new Error("Customer profile normalization failed.");
    }

    const selection = await client.query(`
      SELECT
        variant.id AS product_variant_id,
        color.id AS color_id,
        product.model_code,
        product.name AS product_name,
        color.code AS color_code,
        color.name AS color_name,
        variant.size_code,
        variant.cup_code,
        COALESCE(variant.price_override, product.base_price) AS unit_price,
        product.currency
      FROM japan_underwear.product_variants AS variant
      JOIN japan_underwear.products AS product
        ON product.id = variant.product_id AND product.is_active
      JOIN japan_underwear.product_colors AS color
        ON color.product_id = product.id AND color.is_active
      WHERE variant.is_active
      ORDER BY product.created_at, variant.created_at, color.sort_order
      LIMIT 1
    `);
    if (selection.rowCount !== 1) {
      throw new Error("Không có catalog selection active để chạy Phase 6 runtime verifier.");
    }
    const item = selection.rows[0];
    const unitPrice = Number(item.unit_price);

    const cartResult = await client.query(
      `
        INSERT INTO japan_underwear.carts (token, status)
        VALUES (gen_random_uuid(), 'active')
        RETURNING id
      `,
    );
    const cartId = cartResult.rows[0].id;
    await client.query(
      `
        INSERT INTO japan_underwear.cart_items (
          cart_id, product_variant_id, color_id, quantity, unit_price_snapshot
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, 2, $4)
      `,
      [cartId, item.product_variant_id, item.color_id, unitPrice],
    );

    const failedRequestId = randomUUID();
    const failedOrderCode = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;
    await client.query("SAVEPOINT failed_checkout");
    const failedOrder = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code, source_cart_id, status, customer_store_name,
          customer_name, customer_phone, delivery_address,
          subtotal, currency, customer_user_id, client_request_id
        ) VALUES (
          $1, $2::uuid, 'submitted', 'Store A',
          'Contact A', '0900000001', 'Address A',
          $3, $4, $5::uuid, $6::uuid
        ) RETURNING id
      `,
      [failedOrderCode, cartId, unitPrice * 2, item.currency, userA.id, failedRequestId],
    );
    await client.query(
      `
        INSERT INTO japan_underwear.outbox_events (
          aggregate_type, aggregate_id, event_type, payload
        ) VALUES ('order', $1::uuid, 'order.submitted', '{}'::jsonb)
      `,
      [failedOrder.rows[0].id],
    );
    await client.query(
      "UPDATE japan_underwear.carts SET status = 'converted', converted_at = now() WHERE id = $1::uuid",
      [cartId],
    );
    await client.query("ROLLBACK TO SAVEPOINT failed_checkout");

    const rollbackState = await client.query(
      `
        SELECT
          (SELECT status FROM japan_underwear.carts WHERE id = $1::uuid) AS cart_status,
          (SELECT count(*)::integer FROM japan_underwear.orders WHERE order_code = $2) AS orders,
          (SELECT count(*)::integer FROM japan_underwear.outbox_events AS event
             JOIN japan_underwear.orders AS orders ON orders.id = event.aggregate_id
           WHERE orders.order_code = $2) AS outbox
      `,
      [cartId, failedOrderCode],
    );
    if (
      rollbackState.rows[0]?.cart_status !== "active" ||
      Number(rollbackState.rows[0]?.orders) !== 0 ||
      Number(rollbackState.rows[0]?.outbox) !== 0
    ) {
      throw new Error("Failed checkout did not roll back order/outbox/cart conversion atomically.");
    }

    const requestId = randomUUID();
    const orderCode = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;
    const order = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code, source_cart_id, status, customer_store_name,
          customer_name, customer_phone, delivery_address,
          subtotal, currency, customer_user_id, client_request_id
        ) VALUES (
          $1, $2::uuid, 'submitted', 'Store A',
          'Contact A', '0900000001', 'Address A',
          $3, $4, $5::uuid, $6::uuid
        ) RETURNING id
      `,
      [orderCode, cartId, unitPrice * 2, item.currency, userA.id, requestId],
    );
    const orderId = order.rows[0].id;
    await client.query(
      `
        INSERT INTO japan_underwear.order_items (
          order_id, product_variant_id, color_id, quantity,
          unit_price, line_total, product_code_snapshot,
          product_name_snapshot, color_code_snapshot, color_name_snapshot,
          size_code_snapshot, cup_code_snapshot
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 2,
          $4, $5, $6, $7, $8, $9, $10, $11
        )
      `,
      [
        orderId,
        item.product_variant_id,
        item.color_id,
        unitPrice,
        unitPrice * 2,
        item.model_code,
        item.product_name,
        item.color_code,
        item.color_name,
        item.size_code,
        item.cup_code,
      ],
    );

    const outboxPayload = JSON.stringify({
      orderId,
      orderCode,
      customerUserId: userA.id,
      clientRequestId: requestId,
      subtotal: unitPrice * 2,
      currency: item.currency,
      itemCount: 2,
      createdAt: new Date().toISOString(),
    });

    await client.query(
      `
        INSERT INTO japan_underwear.outbox_events (
          aggregate_type, aggregate_id, event_type, payload
        ) VALUES (
          'order', $1::uuid, 'order.submitted',
          $2::jsonb
        )
      `,
      [orderId, outboxPayload],
    );
    await client.query(
      "UPDATE japan_underwear.carts SET status = 'converted', converted_at = now() WHERE id = $1::uuid",
      [cartId],
    );

    const replayLookup = await client.query(
      `
        SELECT id, order_code
        FROM japan_underwear.orders
        WHERE customer_user_id = $1::uuid
          AND client_request_id = $2::uuid
      `,
      [userA.id, requestId],
    );
    if (
      replayLookup.rowCount !== 1 ||
      String(replayLookup.rows[0].id) !== String(orderId) ||
      replayLookup.rows[0].order_code !== orderCode
    ) {
      throw new Error("Idempotency lookup did not return the original order.");
    }

    const secondCart = await client.query(
      "INSERT INTO japan_underwear.carts (token, status) VALUES (gen_random_uuid(), 'active') RETURNING id",
    );
    await expectPgError("duplicate customer client request", "23505", () =>
      client.query(
        `
          INSERT INTO japan_underwear.orders (
            order_code, source_cart_id, status, customer_store_name,
            customer_name, customer_phone, delivery_address,
            subtotal, currency, customer_user_id, client_request_id
          ) VALUES (
            $1, $2::uuid, 'submitted', 'Store A',
            'Contact A', '0900000001', 'Address A',
            0, 'VND', $3::uuid, $4::uuid
          )
        `,
        [
          `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`,
          secondCart.rows[0].id,
          userA.id,
          requestId,
        ],
      ),
    );

    await expectPgError("client request reassignment", "23514", () =>
      client.query(
        "UPDATE japan_underwear.orders SET client_request_id = $2::uuid WHERE id = $1::uuid",
        [orderId, randomUUID()],
      ),
    );

    const outbox = await client.query(
      `
        SELECT
          status,
          attempts,
          payload->>'orderCode' AS order_code,
          payload->>'clientRequestId' AS client_request_id,
          payload->>'itemCount' AS item_count
        FROM japan_underwear.outbox_events
        WHERE aggregate_id = $1::uuid
          AND event_type = 'order.submitted'
      `,
      [orderId],
    );
    if (
      outbox.rowCount !== 1 ||
      outbox.rows[0].status !== "pending" ||
      Number(outbox.rows[0].attempts) !== 0 ||
      outbox.rows[0].order_code !== orderCode ||
      outbox.rows[0].client_request_id !== requestId ||
      Number(outbox.rows[0].item_count) !== 2
    ) {
      throw new Error("Transactional order.submitted outbox event is invalid.");
    }

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  await client.connect();
  try {
    const schema = await client.query(`
      SELECT
        to_regclass('japan_underwear.customer_profiles') AS customer_profiles,
        to_regclass('japan_underwear.outbox_events') AS outbox_events,
        (SELECT count(*)::integer
         FROM information_schema.columns
         WHERE table_schema = 'japan_underwear'
           AND table_name = 'orders'
           AND column_name = ANY(ARRAY['client_request_id', 'customer_store_name']::text[])) AS order_columns,
        (SELECT count(*)::integer
         FROM pg_indexes
         WHERE schemaname = 'japan_underwear'
           AND indexname = 'orders_customer_client_request_uidx') AS idempotency_index
    `);
    const state = schema.rows[0];
    if (
      !state.customer_profiles ||
      !state.outbox_events ||
      Number(state.order_columns) !== 2 ||
      Number(state.idempotency_index) !== 1
    ) {
      throw new Error("Phase 6 checkout/onboarding schema is incomplete.");
    }

    const migration = await client.query(
      "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [MIGRATION_CREATED_AT],
    );
    if (Number(migration.rows[0]?.count ?? 0) !== 1) {
      throw new Error(`Migration record ${MIGRATION_CREATED_AT} must exist exactly once.`);
    }

    const integrity = await client.query(`
      SELECT
        (SELECT count(*)::integer
         FROM japan_underwear.customer_profiles AS profile
         LEFT JOIN japan_underwear.users AS auth_user ON auth_user.id = profile.user_id
         WHERE auth_user.id IS NULL) AS orphan_profiles,
        (SELECT count(*)::integer
         FROM japan_underwear.outbox_events AS event
         LEFT JOIN japan_underwear.orders AS orders ON orders.id = event.aggregate_id
         WHERE orders.id IS NULL) AS orphan_outbox,
        (SELECT count(*)::integer
         FROM japan_underwear.orders AS orders
         WHERE orders.client_request_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM japan_underwear.outbox_events AS event
             WHERE event.aggregate_id = orders.id
               AND event.event_type = 'order.submitted'
           )) AS owned_orders_missing_outbox
    `);
    if (
      Number(integrity.rows[0]?.orphan_profiles ?? 0) !== 0 ||
      Number(integrity.rows[0]?.orphan_outbox ?? 0) !== 0 ||
      Number(integrity.rows[0]?.owned_orders_missing_outbox ?? 0) !== 0
    ) {
      throw new Error("Phase 6 profile/outbox integrity check failed.");
    }

    await verifyRuntime();

    const counts = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM japan_underwear.customer_profiles) AS profiles,
        (SELECT count(*)::integer FROM japan_underwear.orders WHERE client_request_id IS NOT NULL) AS idempotent_orders,
        (SELECT count(*)::integer FROM japan_underwear.outbox_events) AS outbox_events
    `);

    console.log("Phase 6 checkout and onboarding verification OK.");
    console.log("Onboarding: store + contact + phone + delivery address normalized on write.");
    console.log("Idempotency: one order per customer_user_id + client_request_id.");
    console.log("Retry: replay resolves the original order; failed transaction keeps cart active.");
    console.log("Outbox: one pending order.submitted event is written in the order transaction.");
    console.log("Runtime fixtures: executed inside a transaction and rolled back.");
    console.log(
      `Profiles: ${counts.rows[0].profiles}; idempotent orders: ${counts.rows[0].idempotent_orders}; outbox events: ${counts.rows[0].outbox_events}.`,
    );
    console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
