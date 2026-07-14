import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783895000000;
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
  if (!rejected) {
    throw new Error(`${label} was not rejected with PostgreSQL code ${code}.`);
  }
}

function verifySourceArchitecture() {
  const shared = fs.readFileSync(path.resolve(cwd, "lib/order-creation.ts"), "utf8");
  const checkout = fs.readFileSync(path.resolve(cwd, "lib/customer-checkout.ts"), "utf8");
  const manual = fs.readFileSync(path.resolve(cwd, "lib/manual-orders.ts"), "utf8");
  const cart = fs.readFileSync(path.resolve(cwd, "lib/server-ordering.ts"), "utf8");

  const sharedMarkers = [
    "COALESCE(variant.price_override, product.base_price)",
    "INSERT INTO japan_underwear.orders",
    "INSERT INTO japan_underwear.order_items",
    "INSERT INTO japan_underwear.outbox_events",
    "$2::jsonb",
  ];
  for (const marker of sharedMarkers) {
    if (!shared.includes(marker)) {
      throw new Error(`Shared order writer is missing marker: ${marker}`);
    }
  }

  for (const [label, source] of [
    ["customer checkout", checkout],
    ["manual order", manual],
  ]) {
    if (!source.includes("createOrderFromSelections")) {
      throw new Error(`${label} does not call the shared order writer.`);
    }
    if (source.includes("INSERT INTO japan_underwear.orders")) {
      throw new Error(`${label} still contains a second order insert path.`);
    }
  }

  if (cart.includes("createServerOrder") || cart.includes("INSERT INTO japan_underwear.orders")) {
    throw new Error("Legacy server-ordering still contains a duplicate order creation path.");
  }
}

async function verifySchema() {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer
       FROM information_schema.columns
       WHERE table_schema = 'japan_underwear'
         AND table_name = 'orders'
         AND column_name IN ('order_source', 'manual_request_id', 'created_by_user_id')) AS columns,
      (SELECT is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'japan_underwear'
         AND table_name = 'orders'
         AND column_name = 'source_cart_id') AS source_cart_nullable,
      to_regclass('japan_underwear.orders_staff_manual_request_uidx') AS manual_request_index,
      to_regclass('japan_underwear.orders_source_created_idx') AS source_created_index,
      to_regprocedure('japan_underwear.derive_order_creation_source()') AS derive_function,
      to_regprocedure('japan_underwear.protect_order_customer_owner()') AS protect_function,
      to_regprocedure('japan_underwear.record_order_status_event()') AS audit_function
  `);
  const state = result.rows[0];
  if (
    Number(state.columns) !== 3 ||
    state.source_cart_nullable !== "YES" ||
    !state.manual_request_index ||
    !state.source_created_index ||
    !state.derive_function ||
    !state.protect_function ||
    !state.audit_function
  ) {
    throw new Error("Manual order shared-service schema is incomplete.");
  }

  const migration = await client.query(
    "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [MIGRATION_CREATED_AT],
  );
  if (Number(migration.rows[0]?.count ?? 0) !== 1) {
    throw new Error(`Migration record ${MIGRATION_CREATED_AT} must exist exactly once.`);
  }
}

async function verifyRuntime() {
  await client.query("BEGIN");
  try {
    const suffix = randomUUID();
    const users = await client.query(
      `
        INSERT INTO japan_underwear.users (email, name)
        VALUES
          ($1, 'Manual order verifier staff'),
          ($2, 'Manual order verifier customer')
        RETURNING id
      `,
      [
        `manual-staff-${suffix}@example.invalid`,
        `manual-customer-${suffix}@example.invalid`,
      ],
    );
    const staffUserId = users.rows[0].id;
    const customerUserId = users.rows[1].id;
    await client.query(
      `
        INSERT INTO japan_underwear.user_roles (user_id, role)
        VALUES ($1::uuid, 'sales')
      `,
      [staffUserId],
    );
    await client.query(
      `
        INSERT INTO japan_underwear.customer_profiles (
          user_id, store_name, contact_name, phone, delivery_address
        ) VALUES ($1::uuid, 'Verifier Store', 'Verifier Customer', '0900000000', 'Verifier Address')
      `,
      [customerUserId],
    );

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
        COALESCE(variant.price_override, product.base_price)::integer AS unit_price,
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
      throw new Error("Không có catalog selection active để verify manual order.");
    }
    const item = selection.rows[0];
    const quantity = 2;
    const subtotal = Number(item.unit_price) * quantity;
    const manualRequestId = randomUUID();
    const manualOrderCode = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;
    const actorLabel = "manual-order-verifier";

    await client.query(
      `
        SELECT
          set_config('japan_underwear.order_status_actor_source', 'staff_manual', true),
          set_config('japan_underwear.order_status_actor_label', $1, true),
          set_config('japan_underwear.order_status_idempotency_key', $2, true)
      `,
      [actorLabel, `staff-manual:${staffUserId}:${manualRequestId}`],
    );
    const manualOrder = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code, order_source, source_cart_id, manual_request_id,
          created_by_user_id, status, customer_store_name, customer_name,
          customer_phone, delivery_address, subtotal, currency, customer_user_id
        ) VALUES (
          $1, 'staff_manual', NULL, $2::uuid,
          $3::uuid, 'submitted', 'Verifier Store', 'Verifier Customer',
          '0900000000', 'Verifier Address', $4, $5, $6::uuid
        )
        RETURNING id, order_source, source_cart_id
      `,
      [
        manualOrderCode,
        manualRequestId,
        staffUserId,
        subtotal,
        item.currency,
        customerUserId,
      ],
    );
    const manualOrderId = manualOrder.rows[0].id;
    await client.query(
      `
        INSERT INTO japan_underwear.order_items (
          order_id, product_variant_id, color_id, quantity,
          unit_price, line_total, product_code_snapshot,
          product_name_snapshot, color_code_snapshot, color_name_snapshot,
          size_code_snapshot, cup_code_snapshot
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4,
          $5, $6, $7, $8, $9, $10, $11, $12
        )
      `,
      [
        manualOrderId,
        item.product_variant_id,
        item.color_id,
        quantity,
        item.unit_price,
        subtotal,
        item.model_code,
        item.product_name,
        item.color_code,
        item.color_name,
        item.size_code,
        item.cup_code,
      ],
    );
    const outboxPayload = JSON.stringify({
      orderId: manualOrderId,
      orderCode: manualOrderCode,
      orderSource: "staff_manual",
      manualRequestId,
      createdByUserId: staffUserId,
      subtotal,
      currency: item.currency,
      itemCount: quantity,
    });
    await client.query(
      `
        INSERT INTO japan_underwear.outbox_events (
          aggregate_type, aggregate_id, event_type, payload
        ) VALUES ('order', $1::uuid, 'order.submitted', $2::jsonb)
      `,
      [manualOrderId, outboxPayload],
    );

    const manualState = await client.query(
      `
        SELECT
          orders.order_source,
          orders.source_cart_id,
          orders.customer_user_id,
          orders.created_by_user_id,
          orders.manual_request_id,
          orders.subtotal,
          order_item.unit_price,
          order_item.line_total,
          status_event.actor_source,
          status_event.actor_label,
          status_event.idempotency_key,
          outbox.payload->>'orderSource' AS outbox_source,
          outbox.payload->>'manualRequestId' AS outbox_request
        FROM japan_underwear.orders AS orders
        JOIN japan_underwear.order_items AS order_item
          ON order_item.order_id = orders.id
        JOIN japan_underwear.order_status_events AS status_event
          ON status_event.order_id = orders.id AND status_event.from_status IS NULL
        JOIN japan_underwear.outbox_events AS outbox
          ON outbox.aggregate_id = orders.id AND outbox.event_type = 'order.submitted'
        WHERE orders.id = $1::uuid
      `,
      [manualOrderId],
    );
    const state = manualState.rows[0];
    if (
      manualState.rowCount !== 1 ||
      state.order_source !== "staff_manual" ||
      state.source_cart_id !== null ||
      String(state.customer_user_id) !== String(customerUserId) ||
      String(state.created_by_user_id) !== String(staffUserId) ||
      String(state.manual_request_id) !== manualRequestId ||
      Number(state.subtotal) !== subtotal ||
      Number(state.unit_price) !== Number(item.unit_price) ||
      Number(state.line_total) !== subtotal ||
      state.actor_source !== "staff_manual" ||
      state.actor_label !== actorLabel ||
      state.outbox_source !== "staff_manual" ||
      state.outbox_request !== manualRequestId
    ) {
      throw new Error("Manual order pricing, identity, audit or outbox snapshot is invalid.");
    }

    await expectPgError("duplicate manual request", "23505", () =>
      client.query(
        `
          INSERT INTO japan_underwear.orders (
            order_code, order_source, manual_request_id, created_by_user_id,
            status, customer_name, customer_phone, subtotal, currency
          ) VALUES ($1, 'staff_manual', $2::uuid, $3::uuid,
                    'submitted', 'Duplicate', '0900000001', 0, 'VND')
        `,
        [
          `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`,
          manualRequestId,
          staffUserId,
        ],
      ),
    );

    const invalidCart = await client.query(
      "INSERT INTO japan_underwear.carts (token, status) VALUES (gen_random_uuid(), 'active') RETURNING id",
    );
    await expectPgError("manual order with source cart", "23514", () =>
      client.query(
        `
          INSERT INTO japan_underwear.orders (
            order_code, order_source, source_cart_id, manual_request_id,
            created_by_user_id, status, customer_name, customer_phone,
            subtotal, currency
          ) VALUES ($1, 'staff_manual', $2::uuid, $3::uuid,
                    $4::uuid, 'submitted', 'Invalid', '0900000002', 0, 'VND')
        `,
        [
          `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`,
          invalidCart.rows[0].id,
          randomUUID(),
          staffUserId,
        ],
      ),
    );

    await expectPgError("manual identity mutation", "23514", () =>
      client.query(
        "UPDATE japan_underwear.orders SET manual_request_id = $2::uuid WHERE id = $1::uuid",
        [manualOrderId, randomUUID()],
      ),
    );

    const checkoutCart = await client.query(
      "INSERT INTO japan_underwear.carts (token, status) VALUES (gen_random_uuid(), 'active') RETURNING id",
    );
    const checkoutRequestId = randomUUID();
    const checkoutOrder = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code, source_cart_id, status, customer_store_name,
          customer_name, customer_phone, delivery_address,
          subtotal, currency, customer_user_id, client_request_id
        ) VALUES (
          $1, $2::uuid, 'submitted', 'Verifier Store',
          'Verifier Customer', '0900000000', 'Verifier Address',
          0, 'VND', $3::uuid, $4::uuid
        )
        RETURNING order_source
      `,
      [
        `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`,
        checkoutCart.rows[0].id,
        customerUserId,
        checkoutRequestId,
      ],
    );
    if (checkoutOrder.rows[0]?.order_source !== "customer_checkout") {
      throw new Error("Checkout compatibility insert did not derive customer_checkout source.");
    }

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  verifySourceArchitecture();
  await client.connect();
  try {
    await verifySchema();
    await verifyRuntime();

    const counts = await client.query(`
      SELECT
        count(*) FILTER (WHERE order_source = 'legacy_cart')::integer AS legacy_orders,
        count(*) FILTER (WHERE order_source = 'customer_checkout')::integer AS checkout_orders,
        count(*) FILTER (WHERE order_source = 'staff_manual')::integer AS manual_orders
      FROM japan_underwear.orders
    `);

    console.log("Manual order shared service verification OK.");
    console.log("Shared pricing: customer checkout and staff manual call one writer.");
    console.log("Manual identity: source cart null; creator + request UUID idempotent.");
    console.log("Database source derivation preserves valid legacy checkout inserts.");
    console.log("Audit/outbox/item snapshots: verified in one rollback-only transaction.");
    console.log(
      `Current sources: legacy=${counts.rows[0].legacy_orders}; checkout=${counts.rows[0].checkout_orders}; manual=${counts.rows[0].manual_orders}.`,
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
