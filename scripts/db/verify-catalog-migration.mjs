import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const EXPECTED_TABLES = [
  "auth_accounts",
  "auth_audit_events",
  "auth_sessions",
  "brands",
  "cart_items",
  "carts",
  "catalog_import_runs",
  "categories",
  "customer_profiles",
  "order_items",
  "order_status_events",
  "orders",
  "outbox_events",
  "product_colors",
  "product_images",
  "product_variants",
  "products",
  "user_roles",
  "users",
];

const EXPECTED_MIGRATIONS = [
  1783842973000,
  1783845000000,
  1783849000000,
  1783853000000,
  1783860000000,
  1783865000000,
  1783870000000,
  1783875000000,
  1783880000000,
  1783885000000,
  1783890000000,
];

const REQUIRED_INDEXES = [
  "cart_items_cart_variant_color_uidx",
  "carts_token_uidx",
  "order_items_order_variant_color_uidx",
  "orders_order_code_uidx",
  "orders_source_cart_uidx",
  "product_variants_product_size_cup_uidx",
  "product_variants_product_size_no_cup_uidx",
];

const REQUIRED_ORDER_LOCATION_COLUMNS = [
  "delivery_latitude",
  "delivery_longitude",
  "delivery_accuracy_meters",
  "location_collected_at",
  "location_source",
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
});

async function main() {
  await client.connect();

  try {
    const tableResult = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'japan_underwear'
      ORDER BY tablename
    `);
    const actualTables = tableResult.rows.map((row) => String(row.tablename));
    const missingTables = EXPECTED_TABLES.filter((name) => !actualTables.includes(name));
    const unexpectedTables = actualTables.filter((name) => !EXPECTED_TABLES.includes(name));
    if (missingTables.length > 0 || unexpectedTables.length > 0) {
      throw new Error(
        `Catalog table mismatch. Missing: ${missingTables.join(", ") || "none"}. Unexpected: ${unexpectedTables.join(", ") || "none"}.`,
      );
    }

    const enumResult = await client.query(`
      SELECT namespace.nspname AS schema_name
      FROM pg_type AS type_definition
      JOIN pg_namespace AS namespace
        ON namespace.oid = type_definition.typnamespace
      WHERE type_definition.typname = 'catalog_import_status'
      ORDER BY namespace.nspname
    `);
    const enumSchemas = enumResult.rows.map((row) => String(row.schema_name));
    if (enumSchemas.length !== 1 || enumSchemas[0] !== "japan_underwear") {
      throw new Error(
        `Expected only japan_underwear.catalog_import_status, found: ${enumSchemas.join(", ") || "none"}.`,
      );
    }

    const importStatusResult = await client.query(`
      SELECT type_namespace.nspname AS type_schema,
             type_definition.typname AS type_name
      FROM pg_attribute AS attribute
      JOIN pg_class AS table_definition
        ON table_definition.oid = attribute.attrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_definition.relnamespace
      JOIN pg_type AS type_definition
        ON type_definition.oid = attribute.atttypid
      JOIN pg_namespace AS type_namespace
        ON type_namespace.oid = type_definition.typnamespace
      WHERE table_namespace.nspname = 'japan_underwear'
        AND table_definition.relname = 'catalog_import_runs'
        AND attribute.attname = 'status'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    `);
    if (
      importStatusResult.rowCount !== 1 ||
      importStatusResult.rows[0].type_schema !== "japan_underwear" ||
      importStatusResult.rows[0].type_name !== "catalog_import_status"
    ) {
      throw new Error(
        "catalog_import_runs.status does not use japan_underwear.catalog_import_status.",
      );
    }

    const productIdentityResult = await client.query(`
      SELECT
        to_regclass('japan_underwear.products_brand_category_model_uidx') AS identity_index,
        to_regclass('japan_underwear.products_brand_model_uidx') AS legacy_index,
        information_schema.columns.is_nullable AS category_nullable
      FROM information_schema.columns
      WHERE information_schema.columns.table_schema = 'japan_underwear'
        AND information_schema.columns.table_name = 'products'
        AND information_schema.columns.column_name = 'category_id'
    `);
    if (productIdentityResult.rowCount !== 1) {
      throw new Error("Không đọc được cấu trúc products.category_id.");
    }
    const productIdentity = productIdentityResult.rows[0];
    if (!productIdentity.identity_index) {
      throw new Error("Missing products_brand_category_model_uidx.");
    }
    if (productIdentity.legacy_index) {
      throw new Error("Legacy products_brand_model_uidx still exists.");
    }
    if (productIdentity.category_nullable !== "NO") {
      throw new Error("products.category_id must be NOT NULL.");
    }

    const variantColumnResult = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND table_name = 'product_variants'
        AND column_name IN ('color_id', 'size_code', 'cup_code')
      ORDER BY column_name
    `);
    const variantColumns = new Map(
      variantColumnResult.rows.map((row) => [String(row.column_name), String(row.is_nullable)]),
    );
    if (variantColumns.has("color_id")) {
      throw new Error("product_variants.color_id must not exist after migration 0003.");
    }
    if (variantColumns.get("size_code") !== "NO") {
      throw new Error("product_variants.size_code must be NOT NULL.");
    }
    if (variantColumns.get("cup_code") !== "YES") {
      throw new Error("product_variants.cup_code must exist and be nullable.");
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
      throw new Error(`Missing required indexes: ${missingIndexes.join(", ")}.`);
    }

    const legacyVariantIndexResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'japan_underwear'
        AND indexname IN (
          'product_variants_product_color_size_uidx',
          'product_variants_color_idx'
        )
    `);
    if (legacyVariantIndexResult.rowCount > 0) {
      throw new Error(
        `Legacy color-linked variant indexes still exist: ${legacyVariantIndexResult.rows.map((row) => row.indexname).join(", ")}.`,
      );
    }

    const triggerResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'japan_underwear'
        AND trigger_name IN (
          'cart_items_selection_same_product_trg',
          'order_items_selection_same_product_trg'
        )
    `);
    const triggers = new Set(
      triggerResult.rows.map((row) => `${row.event_object_table}:${row.trigger_name}`),
    );
    if (!triggers.has("cart_items:cart_items_selection_same_product_trg")) {
      throw new Error("Missing cart_items selection identity trigger.");
    }
    if (!triggers.has("order_items:order_items_selection_same_product_trg")) {
      throw new Error("Missing order_items selection identity trigger.");
    }

    const lineColumnResult = await client.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND (
          (table_name = 'cart_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
          OR (table_name = 'order_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
        )
    `);
    const lineColumns = new Map(
      lineColumnResult.rows.map((row) => [
        `${row.table_name}.${row.column_name}`,
        String(row.is_nullable),
      ]),
    );
    for (const key of [
      "cart_items.product_variant_id",
      "cart_items.color_id",
      "cart_items.quantity",
      "order_items.product_variant_id",
      "order_items.color_id",
      "order_items.quantity",
    ]) {
      if (lineColumns.get(key) !== "NO") {
        throw new Error(`${key} must exist and be NOT NULL.`);
      }
    }

    const locationColumnResult = await client.query(
      `
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'orders'
          AND column_name = ANY($1::text[])
      `,
      [REQUIRED_ORDER_LOCATION_COLUMNS],
    );
    const locationColumns = new Map(
      locationColumnResult.rows.map((row) => [String(row.column_name), String(row.is_nullable)]),
    );
    for (const columnName of REQUIRED_ORDER_LOCATION_COLUMNS) {
      if (locationColumns.get(columnName) !== "YES") {
        throw new Error(`orders.${columnName} must exist and be nullable.`);
      }
    }

    const migrationTableResult = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
    );
    if (!migrationTableResult.rows[0]?.table_name) {
      throw new Error("drizzle.__drizzle_migrations does not exist.");
    }

    const migrationResult = await client.query(`
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at
    `);
    const appliedMigrations = migrationResult.rows.map((row) => Number(row.created_at));
    const missingMigrations = EXPECTED_MIGRATIONS.filter(
      (createdAt) => !appliedMigrations.includes(createdAt),
    );
    if (missingMigrations.length > 0) {
      throw new Error(`Missing Drizzle migration records: ${missingMigrations.join(", ")}.`);
    }

    console.log("Catalog DB verification OK.");
    console.log(`Tables: ${actualTables.length}.`);
    console.log("Enum: japan_underwear.catalog_import_status.");
    console.log("Product identity: brand + category + model.");
    console.log("Variant identity: product + size + cup; color selected separately per order line.");
    console.log("Server cart identity: cart + product_variant_id + color_id.");
    console.log("Order item identity: order + product_variant_id + color_id; quantity stored on the row.");
    console.log("Order lifecycle audit table: japan_underwear.order_status_events.");
    console.log("Order delivery location: optional all-or-none snapshot on orders.");
    console.log("Auth identity: internal UUID + external account mapping + database sessions.");
    console.log(
      `Migration records: ${appliedMigrations.length} (${EXPECTED_MIGRATIONS.length} required records present).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
