import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783880000000;
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

async function verifyRuntimeOwnership() {
  await client.query("BEGIN");
  try {
    const suffix = randomUUID();
    const userResult = await client.query(
      `
        INSERT INTO japan_underwear.users (email, name)
        VALUES
          ($1, 'Ownership verifier A'),
          ($2, 'Ownership verifier B')
        RETURNING id
      `,
      [`ownership-a-${suffix}@example.invalid`, `ownership-b-${suffix}@example.invalid`],
    );
    const [userA, userB] = userResult.rows;

    const cartResult = await client.query(`
      INSERT INTO japan_underwear.carts (token, status)
      VALUES (gen_random_uuid(), 'converted'), (gen_random_uuid(), 'converted'), (gen_random_uuid(), 'converted')
      RETURNING id
    `);
    const [cartA, cartB, cartLegacy] = cartResult.rows;
    const codeA = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;
    const codeB = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;
    const codeLegacy = `TT-20990101-${randomUUID().slice(0, 8).toUpperCase()}`;

    await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code, source_cart_id, status, customer_user_id,
          customer_name, customer_phone, subtotal, currency
        ) VALUES
          ($1, $2::uuid, 'submitted', $3::uuid, 'Customer A', '0900000001', 1000, 'VND'),
          ($4, $5::uuid, 'submitted', $6::uuid, 'Customer B', '0900000002', 2000, 'VND'),
          ($7, $8::uuid, 'submitted', NULL, 'Legacy Customer', '0900000003', 3000, 'VND')
      `,
      [codeA, cartA.id, userA.id, codeB, cartB.id, userB.id, codeLegacy, cartLegacy.id],
    );

    const scopedA = await client.query(
      `
        SELECT order_code
        FROM japan_underwear.orders
        WHERE customer_user_id = $1::uuid
          AND order_code = ANY($2::text[])
        ORDER BY order_code
      `,
      [userA.id, [codeA, codeB, codeLegacy]],
    );
    if (scopedA.rowCount !== 1 || scopedA.rows[0].order_code !== codeA) {
      throw new Error("Customer A ownership scope returned another customer's or legacy order.");
    }

    const hiddenOrder = await client.query(
      `
        SELECT count(*)::integer AS count
        FROM japan_underwear.orders
        WHERE order_code = $1
          AND customer_user_id = $2::uuid
      `,
      [codeB, userA.id],
    );
    if (Number(hiddenOrder.rows[0]?.count ?? 0) !== 0) {
      throw new Error("Cross-customer order lookup was not hidden.");
    }

    await client.query(
      `UPDATE japan_underwear.orders SET customer_user_id = $2::uuid WHERE order_code = $1`,
      [codeLegacy, userA.id],
    );

    await client.query("SAVEPOINT owner_reassignment_probe");
    let reassignmentRejected = false;
    try {
      await client.query(
        `UPDATE japan_underwear.orders SET customer_user_id = $2::uuid WHERE order_code = $1`,
        [codeA, userB.id],
      );
    } catch (error) {
      reassignmentRejected = error?.code === "23514";
      await client.query("ROLLBACK TO SAVEPOINT owner_reassignment_probe");
    }
    if (!reassignmentRejected) {
      throw new Error("Assigned order owner could be changed.");
    }

    const unchangedOwner = await client.query(
      `SELECT customer_user_id FROM japan_underwear.orders WHERE order_code = $1`,
      [codeA],
    );
    if (String(unchangedOwner.rows[0]?.customer_user_id) !== String(userA.id)) {
      throw new Error("Rejected owner reassignment changed the stored owner.");
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
    const schemaResult = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'japan_underwear'
            AND table_name = 'orders'
            AND column_name = 'customer_user_id'
            AND data_type = 'uuid'
        ) AS has_owner_column,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'japan_underwear'
            AND indexname = 'orders_customer_user_created_idx'
        ) AS has_owner_index,
        EXISTS (
          SELECT 1 FROM information_schema.triggers
          WHERE trigger_schema = 'japan_underwear'
            AND trigger_name = 'orders_customer_owner_guard_trg'
        ) AS has_owner_guard
    `);
    const state = schemaResult.rows[0];
    if (!state.has_owner_column || !state.has_owner_index || !state.has_owner_guard) {
      throw new Error("Customer order ownership schema is incomplete.");
    }

    const orphanResult = await client.query(`
      SELECT count(*)::integer AS count
      FROM japan_underwear.orders AS orders
      LEFT JOIN japan_underwear.users AS auth_user
        ON auth_user.id = orders.customer_user_id
      WHERE orders.customer_user_id IS NOT NULL
        AND auth_user.id IS NULL
    `);
    if (Number(orphanResult.rows[0]?.count ?? 0) !== 0) {
      throw new Error("Orders contain orphan customer owners.");
    }

    const migrationResult = await client.query(
      "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [MIGRATION_CREATED_AT],
    );
    if (Number(migrationResult.rows[0]?.count ?? 0) !== 1) {
      throw new Error(`Migration record ${MIGRATION_CREATED_AT} must exist exactly once.`);
    }

    await verifyRuntimeOwnership();

    const countsResult = await client.query(`
      SELECT
        count(*)::integer AS orders,
        count(*) FILTER (WHERE customer_user_id IS NOT NULL)::integer AS owned_orders,
        count(*) FILTER (WHERE customer_user_id IS NULL)::integer AS legacy_or_staff_orders
      FROM japan_underwear.orders
    `);
    const counts = countsResult.rows[0];

    console.log("Customer order ownership verification OK.");
    console.log("Customer lookup scope: internal user UUID + order code.");
    console.log("Cross-customer lookup: hidden as not found.");
    console.log("Owner reassignment: rejected by database trigger.");
    console.log("Runtime fixtures: executed inside a transaction and rolled back.");
    console.log(
      `Orders: ${counts.orders}; owned: ${counts.owned_orders}; legacy/staff unowned: ${counts.legacy_or_staff_orders}.`,
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
