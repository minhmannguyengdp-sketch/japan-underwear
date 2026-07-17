import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783900000000;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});

async function verifyStructure() {
  const migrationResult = await client.query(
    "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [MIGRATION_CREATED_AT],
  );
  assert(migrationResult.rowCount === 1, "Thiếu migration record 0012.");

  const relationResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.catalog_change_audit') AS audit_table,
      to_regprocedure('japan_underwear.bump_catalog_row_version()') AS version_function,
      to_regprocedure('japan_underwear.record_catalog_change_audit()') AS audit_function
  `);
  assert(relationResult.rows[0]?.audit_table, "Thiếu catalog_change_audit.");
  assert(relationResult.rows[0]?.version_function, "Thiếu bump_catalog_row_version().");
  assert(relationResult.rows[0]?.audit_function, "Thiếu record_catalog_change_audit().");

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
      assert(
        columns.get(`${table}.${column}`) === "NO",
        `${table}.${column} phải tồn tại và NOT NULL.`,
      );
    }
  }

  const triggerResult = await client.query(`
    SELECT event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'japan_underwear'
      AND trigger_name LIKE '%_catalog_%_trg'
  `);
  const triggers = new Set(
    triggerResult.rows.map((row) => `${row.event_object_table}:${row.trigger_name}`),
  );
  for (const expected of [
    "products:products_catalog_version_trg",
    "products:products_catalog_audit_trg",
    "product_colors:product_colors_catalog_version_trg",
    "product_colors:product_colors_catalog_audit_trg",
    "product_variants:product_variants_catalog_version_trg",
    "product_variants:product_variants_catalog_audit_trg",
  ]) {
    assert(triggers.has(expected), `Thiếu trigger ${expected}.`);
  }
}

async function orderSnapshotHash(variantId) {
  const result = await client.query(
    `
      SELECT md5(COALESCE(string_agg(
        concat_ws(
          '|',
          id::text,
          order_id::text,
          quantity::text,
          unit_price::text,
          line_total::text,
          product_code_snapshot,
          product_name_snapshot,
          color_code_snapshot,
          color_name_snapshot,
          size_code_snapshot,
          COALESCE(cup_code_snapshot, '')
        ),
        ',' ORDER BY id
      ), '')) AS snapshot_hash
      FROM japan_underwear.order_items
      WHERE product_variant_id = $1::uuid
    `,
    [variantId],
  );
  return String(result.rows[0]?.snapshot_hash ?? "");
}

async function main() {
  await client.connect();
  await verifyStructure();

  const fixtureResult = await client.query(`
    SELECT
      product.id AS product_id,
      product.base_price,
      product.row_version AS product_version,
      color.id AS color_id,
      color.is_active AS color_active,
      color.row_version AS color_version,
      variant.id AS variant_id,
      variant.price_override,
      variant.row_version AS variant_version
    FROM japan_underwear.products AS product
    JOIN LATERAL (
      SELECT id, is_active, row_version
      FROM japan_underwear.product_colors
      WHERE product_id = product.id
      ORDER BY id
      LIMIT 1
    ) AS color ON true
    JOIN LATERAL (
      SELECT id, price_override, row_version
      FROM japan_underwear.product_variants
      WHERE product_id = product.id
      ORDER BY id
      LIMIT 1
    ) AS variant ON true
    ORDER BY product.id
    LIMIT 1
  `);
  assert(fixtureResult.rowCount === 1, "Không có product/color/variant để chạy verifier 0012.");
  const fixture = fixtureResult.rows[0];
  const productId = String(fixture.product_id);
  const colorId = String(fixture.color_id);
  const variantId = String(fixture.variant_id);
  const productVersion = Number(fixture.product_version);
  const colorVersion = Number(fixture.color_version);
  const variantVersion = Number(fixture.variant_version);
  const originalBasePrice = Number(fixture.base_price);
  const originalColorActive = Boolean(fixture.color_active);
  const originalVariantPrice =
    fixture.price_override == null ? null : Number(fixture.price_override);
  const nextBasePrice =
    originalBasePrice >= 2_147_483_647 ? originalBasePrice - 1 : originalBasePrice + 1;
  const nextVariantPrice =
    originalVariantPrice === null
      ? nextBasePrice >= 2_147_483_647
        ? 0
        : nextBasePrice + 1
      : originalVariantPrice >= 2_147_483_647
        ? originalVariantPrice - 1
        : originalVariantPrice + 1;
  const actorUserId = crypto.randomUUID();
  const productRequestId = crypto.randomUUID();
  const colorRequestId = crypto.randomUUID();
  const variantRequestId = crypto.randomUUID();
  const actorEmail = `catalog-verifier-${actorUserId}@example.invalid`;
  const orderHashBefore = await orderSnapshotHash(variantId);

  await client.query("BEGIN");
  try {
    await client.query(
      `
        INSERT INTO japan_underwear.users (id, name, email, status)
        VALUES ($1::uuid, 'Catalog verifier', $2, 'active')
      `,
      [actorUserId, actorEmail],
    );
    await client.query(
      "SELECT set_config('japan_underwear.catalog_actor_user_id', $1, true)",
      [actorUserId],
    );
    await client.query(
      "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
      ["rollback-verifier:catalog-price-management"],
    );

    await client.query(
      "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
      [productRequestId],
    );
    const productUpdate = await client.query(
      `
        UPDATE japan_underwear.products
        SET base_price = $3
        WHERE id = $1::uuid
          AND row_version = $2
        RETURNING base_price, row_version
      `,
      [productId, productVersion, nextBasePrice],
    );
    assert(productUpdate.rowCount === 1, "Không update được product bằng expected version.");
    assert(
      Number(productUpdate.rows[0].row_version) === productVersion + 1,
      "Product row_version không tăng đúng một đơn vị.",
    );

    const noOpProductUpdate = await client.query(
      `
        UPDATE japan_underwear.products
        SET base_price = $3
        WHERE id = $1::uuid
          AND row_version = $2
        RETURNING row_version
      `,
      [productId, productVersion + 1, nextBasePrice],
    );
    assert(noOpProductUpdate.rowCount === 1, "No-op product update không chạy được.");
    assert(
      Number(noOpProductUpdate.rows[0].row_version) === productVersion + 1,
      "No-op product update đã tăng row_version.",
    );

    const staleProductUpdate = await client.query(
      `
        UPDATE japan_underwear.products
        SET base_price = $3
        WHERE id = $1::uuid
          AND row_version = $2
      `,
      [productId, productVersion, originalBasePrice],
    );
    assert(staleProductUpdate.rowCount === 0, "Optimistic guard cho product không chặn version cũ.");

    await client.query(
      "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
      [colorRequestId],
    );
    const colorUpdate = await client.query(
      `
        UPDATE japan_underwear.product_colors
        SET is_active = $3
        WHERE id = $1::uuid
          AND row_version = $2
        RETURNING is_active, row_version
      `,
      [colorId, colorVersion, !originalColorActive],
    );
    assert(colorUpdate.rowCount === 1, "Không update được color bằng expected version.");
    assert(
      Number(colorUpdate.rows[0].row_version) === colorVersion + 1,
      "Color row_version không tăng đúng một đơn vị.",
    );

    await client.query(
      "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
      [variantRequestId],
    );
    const variantUpdate = await client.query(
      `
        UPDATE japan_underwear.product_variants
        SET price_override = $3
        WHERE id = $1::uuid
          AND row_version = $2
        RETURNING price_override, row_version
      `,
      [variantId, variantVersion, nextVariantPrice],
    );
    assert(variantUpdate.rowCount === 1, "Không update được variant bằng expected version.");
    assert(
      Number(variantUpdate.rows[0].row_version) === variantVersion + 1,
      "Variant row_version không tăng đúng một đơn vị.",
    );

    const auditResult = await client.query(
      `
        SELECT entity_type, entity_id, product_id, request_id, actor_user_id,
               before_snapshot, after_snapshot
        FROM japan_underwear.catalog_change_audit
        WHERE request_id = ANY($1::uuid[])
        ORDER BY entity_type
      `,
      [[productRequestId, colorRequestId, variantRequestId]],
    );
    assert(
      auditResult.rowCount === 3,
      "Catalog audit phải ghi đúng ba thay đổi và bỏ qua no-op update.",
    );
    for (const row of auditResult.rows) {
      assert(String(row.actor_user_id) === actorUserId, "Catalog audit sai actor_user_id.");
      assert(String(row.product_id) === productId, "Catalog audit sai product_id.");
      assert(
        Number(row.after_snapshot.row_version) === Number(row.before_snapshot.row_version) + 1,
        "Catalog audit không chụp đúng chuyển đổi row_version.",
      );
    }

    const orderHashAfter = await orderSnapshotHash(variantId);
    assert(
      orderHashAfter === orderHashBefore,
      "Thay đổi catalog đã làm thay đổi order item snapshot lịch sử.",
    );

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  const rollbackResult = await client.query(
    `
      SELECT
        (SELECT base_price FROM japan_underwear.products WHERE id = $1::uuid) AS base_price,
        (SELECT row_version FROM japan_underwear.products WHERE id = $1::uuid) AS product_version,
        (SELECT is_active FROM japan_underwear.product_colors WHERE id = $2::uuid) AS color_active,
        (SELECT row_version FROM japan_underwear.product_colors WHERE id = $2::uuid) AS color_version,
        (SELECT price_override FROM japan_underwear.product_variants WHERE id = $3::uuid) AS variant_price,
        (SELECT row_version FROM japan_underwear.product_variants WHERE id = $3::uuid) AS variant_version,
        (SELECT count(*) FROM japan_underwear.catalog_change_audit
          WHERE request_id = ANY($4::uuid[])) AS audit_count,
        (SELECT count(*) FROM japan_underwear.users WHERE id = $5::uuid) AS actor_count
    `,
    [
      productId,
      colorId,
      variantId,
      [productRequestId, colorRequestId, variantRequestId],
      actorUserId,
    ],
  );
  const rollback = rollbackResult.rows[0];
  assert(Number(rollback.base_price) === originalBasePrice, "Rollback không phục hồi base_price.");
  assert(Number(rollback.product_version) === productVersion, "Rollback không phục hồi product version.");
  assert(Boolean(rollback.color_active) === originalColorActive, "Rollback không phục hồi color.");
  assert(Number(rollback.color_version) === colorVersion, "Rollback không phục hồi color version.");
  assert(
    rollback.variant_price == null
      ? originalVariantPrice === null
      : Number(rollback.variant_price) === originalVariantPrice,
    "Rollback không phục hồi variant price.",
  );
  assert(Number(rollback.variant_version) === variantVersion, "Rollback không phục hồi variant version.");
  assert(Number(rollback.audit_count) === 0, "Rollback còn sót catalog audit.");
  assert(Number(rollback.actor_count) === 0, "Rollback còn sót verifier user.");
  assert((await orderSnapshotHash(variantId)) === orderHashBefore, "Order snapshot đổi sau rollback.");

  console.log("Catalog price management verification OK.");
  console.log("Optimistic version guard: product/color/variant pass.");
  console.log("Database audit trigger: pass.");
  console.log("Historical order snapshots unchanged: pass.");
  console.log("Runtime probe rolled back completely.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
