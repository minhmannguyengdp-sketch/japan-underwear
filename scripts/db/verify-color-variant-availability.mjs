import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783905000000;
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
  query_timeout: 120_000,
});

async function expectSelectionRejected(label, work) {
  const savepoint = `verify_${label.replaceAll(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await work();
  } catch (error) {
    rejected =
      error?.code === "23514" &&
      error?.constraint === "orderable_color_variant_selection_chk";
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  if (!rejected) {
    throw new Error(`${label} was not rejected by exact color–size/cup enforcement.`);
  }
}

function verifySourceArchitecture() {
  const catalog = fs.readFileSync(path.resolve(cwd, "lib/catalog.ts"), "utf8");
  const catalogTypes = fs.readFileSync(path.resolve(cwd, "lib/catalog-types.ts"), "utf8");
  const storefront = fs.readFileSync(
    path.resolve(cwd, "components/catalog-ordering-v2.tsx"),
    "utf8",
  );
  const manual = fs.readFileSync(
    path.resolve(cwd, "components/admin/manual-order-form.tsx"),
    "utf8",
  );
  const cartHttp = fs.readFileSync(path.resolve(cwd, "lib/cart-http.ts"), "utf8");
  const staffHttp = fs.readFileSync(path.resolve(cwd, "lib/staff-http.ts"), "utf8");
  const migration = fs.readFileSync(
    path.resolve(cwd, "drizzle/0013_color_variant_availability.sql"),
    "utf8",
  );

  for (const marker of [
    "product_color_variants",
    "variantIds",
    "colors.some((color) => color.variantIds.length > 0)",
  ]) {
    if (!catalog.includes(marker)) {
      throw new Error(`Catalog source is missing marker: ${marker}`);
    }
  }
  if (!catalogTypes.includes("missing-color-size-link")) {
    throw new Error("Catalog type does not expose the missing relation blocker.");
  }
  for (const [label, source] of [
    ["storefront", storefront],
    ["manual order", manual],
  ]) {
    if (!source.includes("variantsForColor") || !source.includes("variantIds")) {
      throw new Error(`${label} does not filter size/cup by color.`);
    }
  }
  for (const [label, source] of [
    ["cart HTTP", cartHttp],
    ["staff HTTP", staffHttp],
  ]) {
    if (!source.includes("invalid_color_variant_selection")) {
      throw new Error(`${label} does not map invalid color–size/cup errors.`);
    }
  }
  for (const marker of [
    "validate_product_color_variant_identity",
    "validate_orderable_color_variant_selection",
    "cart_items_color_variant_selection_trg",
    "order_items_color_variant_selection_trg",
  ]) {
    if (!migration.includes(marker)) {
      throw new Error(`Migration is missing marker: ${marker}`);
    }
  }
}

async function verifySchema() {
  const result = await client.query(`
    SELECT
      to_regclass('japan_underwear.product_color_variants') AS availability_table,
      to_regclass('japan_underwear.product_color_variants_color_variant_uidx') AS pair_index,
      to_regprocedure('japan_underwear.validate_product_color_variant_identity()') AS identity_function,
      to_regprocedure('japan_underwear.validate_orderable_color_variant_selection()') AS selection_function,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'product_color_variants_identity_trg' AND NOT tgisinternal
      ) AS identity_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'cart_items_color_variant_selection_trg' AND NOT tgisinternal
      ) AS cart_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'order_items_color_variant_selection_trg' AND NOT tgisinternal
      ) AS order_trigger
  `);
  const state = result.rows[0];
  if (
    !state.availability_table ||
    !state.pair_index ||
    !state.identity_function ||
    !state.selection_function ||
    !state.identity_trigger ||
    !state.cart_trigger ||
    !state.order_trigger
  ) {
    throw new Error("Color–size/cup schema or triggers are incomplete.");
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
    const suffix = randomUUID().slice(0, 8);
    const brand = await client.query(
      `INSERT INTO japan_underwear.brands (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Availability ${suffix}`, `availability-${suffix}`],
    );
    const category = await client.query(
      `INSERT INTO japan_underwear.categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Availability ${suffix}`, `availability-category-${suffix}`],
    );
    const product = await client.query(
      `INSERT INTO japan_underwear.products
         (brand_id, category_id, model_code, name, slug, base_price, currency, is_active)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 100000, 'VND', true)
       RETURNING id`,
      [
        brand.rows[0].id,
        category.rows[0].id,
        `V${suffix.slice(0, 3)}`,
        `Availability product ${suffix}`,
        `availability-product-${suffix}`,
      ],
    );
    const productId = product.rows[0].id;
    const colors = await client.query(
      `INSERT INTO japan_underwear.product_colors
         (product_id, code, name, sort_order, is_active)
       VALUES
         ($1::uuid, 'den', 'Đen', 0, true),
         ($1::uuid, 'da', 'Da', 1, true)
       RETURNING id, code`,
      [productId],
    );
    const colorByCode = new Map(colors.rows.map((row) => [row.code, row.id]));
    const variants = await client.query(
      `INSERT INTO japan_underwear.product_variants
         (product_id, size_code, cup_code, is_active)
       VALUES
         ($1::uuid, '75', 'A', true),
         ($1::uuid, '80', 'B', true)
       RETURNING id, size_code, cup_code`,
      [productId],
    );
    const variantByLabel = new Map(
      variants.rows.map((row) => [`${row.size_code}${row.cup_code}`, row.id]),
    );

    await client.query(
      `INSERT INTO japan_underwear.product_color_variants
         (product_id, color_id, variant_id, source, is_active)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'runtime-verifier', true)`,
      [productId, colorByCode.get("den"), variantByLabel.get("75A")],
    );

    await expectSelectionRejected("cross_product_relation", () =>
      client.query(
        `INSERT INTO japan_underwear.product_color_variants
           (product_id, color_id, variant_id, source, is_active)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'runtime-verifier', true)`,
        [brand.rows[0].id, colorByCode.get("da"), variantByLabel.get("80B")],
      ),
    );

    const cart = await client.query(
      `INSERT INTO japan_underwear.carts (token, status)
       VALUES (gen_random_uuid(), 'active') RETURNING id`,
    );
    await client.query(
      `INSERT INTO japan_underwear.cart_items
         (cart_id, product_variant_id, color_id, quantity, unit_price_snapshot)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 100000)`,
      [cart.rows[0].id, variantByLabel.get("75A"), colorByCode.get("den")],
    );
    await expectSelectionRejected("invalid_cart_selection", () =>
      client.query(
        `INSERT INTO japan_underwear.cart_items
           (cart_id, product_variant_id, color_id, quantity, unit_price_snapshot)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 100000)`,
        [cart.rows[0].id, variantByLabel.get("80B"), colorByCode.get("da")],
      ),
    );

    const order = await client.query(
      `INSERT INTO japan_underwear.orders
         (order_code, order_source, source_cart_id, status, customer_name,
          customer_phone, subtotal, currency)
       VALUES ($1, 'legacy_cart', $2::uuid, 'submitted',
               'Availability verifier', '0900000000', 100000, 'VND')
       RETURNING id`,
      [`TT-20990101-${suffix.toUpperCase()}`, cart.rows[0].id],
    );
    await client.query(
      `INSERT INTO japan_underwear.order_items
         (order_id, product_variant_id, color_id, quantity, unit_price, line_total,
          product_code_snapshot, product_name_snapshot, color_code_snapshot,
          color_name_snapshot, size_code_snapshot, cup_code_snapshot)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 100000, 100000,
               'VERIFY', 'Verifier', 'den', 'Đen', '75', 'A')`,
      [order.rows[0].id, variantByLabel.get("75A"), colorByCode.get("den")],
    );
    await expectSelectionRejected("invalid_order_selection", () =>
      client.query(
        `INSERT INTO japan_underwear.order_items
           (order_id, product_variant_id, color_id, quantity, unit_price, line_total,
            product_code_snapshot, product_name_snapshot, color_code_snapshot,
            color_name_snapshot, size_code_snapshot, cup_code_snapshot)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 100000, 100000,
                 'VERIFY', 'Verifier', 'da', 'Da', '80', 'B')`,
        [order.rows[0].id, variantByLabel.get("80B"), colorByCode.get("da")],
      ),
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

try {
  verifySourceArchitecture();
  await client.connect();
  await verifySchema();
  await verifyRuntime();
  console.log("Color–size/cup availability schema and runtime verified.");
} finally {
  await client.end().catch(() => undefined);
}
