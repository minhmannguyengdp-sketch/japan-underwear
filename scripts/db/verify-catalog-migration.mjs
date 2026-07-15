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
  "catalog_change_audit",
  "catalog_import_runs",
  "categories",
  "customer_profiles",
  "order_items",
  "order_status_events",
  "orders",
  "outbox_events",
  "product_color_variants",
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
  1783895000000,
  1783900000000,
  1783905000000,
];

const REQUIRED_INDEXES = [
  "cart_items_cart_variant_color_uidx",
  "carts_token_uidx",
  "catalog_change_audit_actor_created_idx",
  "catalog_change_audit_entity_created_idx",
  "catalog_change_audit_product_created_idx",
  "catalog_change_audit_request_idx",
  "order_items_order_variant_color_uidx",
  "orders_order_code_uidx",
  "orders_source_cart_uidx",
  "orders_staff_manual_request_uidx",
  "orders_source_created_idx",
  "product_color_variants_color_variant_uidx",
  "product_color_variants_product_active_idx",
  "product_variants_product_size_cup_uidx",
  "product_variants_product_size_no_cup_uidx",
];

const REQUIRED_TRIGGERS = [
  "cart_items:cart_items_selection_same_product_trg",
  "cart_items:cart_items_color_variant_selection_trg",
  "order_items:order_items_selection_same_product_trg",
  "order_items:order_items_color_variant_selection_trg",
  "orders:orders_creation_source_derive_trg",
  "product_color_variants:product_color_variants_identity_trg",
  "products:products_catalog_version_trg",
  "products:products_catalog_audit_trg",
  "product_colors:product_colors_catalog_version_trg",
  "product_colors:product_colors_catalog_audit_trg",
  "product_variants:product_variants_catalog_version_trg",
  "product_variants:product_variants_catalog_audit_trg",
];

const REQUIRED_FUNCTIONS = [
  "japan_underwear.bump_catalog_row_version()",
  "japan_underwear.record_catalog_change_audit()",
  "japan_underwear.validate_product_color_variant_identity()",
  "japan_underwear.validate_orderable_color_variant_selection()",
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 120_000,
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
    assert(
      missingTables.length === 0 && unexpectedTables.length === 0,
      `Catalog table mismatch. Missing: ${missingTables.join(", ") || "none"}. Unexpected: ${unexpectedTables.join(", ") || "none"}.`,
    );

    const enumResult = await client.query(`
      SELECT namespace.nspname AS schema_name
      FROM pg_type AS type_definition
      JOIN pg_namespace AS namespace ON namespace.oid = type_definition.typnamespace
      WHERE type_definition.typname = 'catalog_import_status'
      ORDER BY namespace.nspname
    `);
    const enumSchemas = enumResult.rows.map((row) => String(row.schema_name));
    assert(
      enumSchemas.length === 1 && enumSchemas[0] === "japan_underwear",
      `Expected only japan_underwear.catalog_import_status, found: ${enumSchemas.join(", ") || "none"}.`,
    );

    const productIdentity = await client.query(`
      SELECT
        to_regclass('japan_underwear.products_brand_category_model_uidx') AS identity_index,
        to_regclass('japan_underwear.products_brand_model_uidx') AS legacy_index,
        information_schema.columns.is_nullable AS category_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND table_name = 'products'
        AND column_name = 'category_id'
    `);
    assert(productIdentity.rowCount === 1, "Không đọc được products.category_id.");
    assert(productIdentity.rows[0].identity_index, "Missing products_brand_category_model_uidx.");
    assert(!productIdentity.rows[0].legacy_index, "Legacy products_brand_model_uidx still exists.");
    assert(productIdentity.rows[0].category_nullable === "NO", "products.category_id must be NOT NULL.");

    const variantColumnsResult = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND table_name = 'product_variants'
        AND column_name IN ('color_id', 'size_code', 'cup_code')
    `);
    const variantColumns = new Map(
      variantColumnsResult.rows.map((row) => [String(row.column_name), String(row.is_nullable)]),
    );
    assert(!variantColumns.has("color_id"), "product_variants.color_id must not exist.");
    assert(variantColumns.get("size_code") === "NO", "product_variants.size_code must be NOT NULL.");
    assert(variantColumns.get("cup_code") === "YES", "product_variants.cup_code must be nullable.");

    const availabilityColumnsResult = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND table_name = 'product_color_variants'
        AND column_name IN ('product_id', 'color_id', 'variant_id', 'source', 'is_active')
    `);
    const availabilityColumns = new Map(
      availabilityColumnsResult.rows.map((row) => [
        String(row.column_name),
        String(row.is_nullable),
      ]),
    );
    for (const name of ["product_id", "color_id", "variant_id", "source", "is_active"]) {
      assert(
        availabilityColumns.get(name) === "NO",
        `product_color_variants.${name} must exist and be NOT NULL.`,
      );
    }

    const indexResult = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'japan_underwear'
         AND indexname = ANY($1::text[])`,
      [REQUIRED_INDEXES],
    );
    const indexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
    const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name));
    assert(missingIndexes.length === 0, `Missing required indexes: ${missingIndexes.join(", ")}.`);

    const legacyVariantIndexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'japan_underwear'
        AND indexname IN ('product_variants_product_color_size_uidx', 'product_variants_color_idx')
    `);
    assert(legacyVariantIndexes.rowCount === 0, "Legacy color-linked variant indexes still exist.");

    const triggerResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'japan_underwear'
    `);
    const triggers = new Set(
      triggerResult.rows.map((row) => `${row.event_object_table}:${row.trigger_name}`),
    );
    for (const key of REQUIRED_TRIGGERS) {
      assert(triggers.has(key), `Missing required trigger: ${key}.`);
    }

    const lineColumnsResult = await client.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND (
          (table_name = 'cart_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
          OR (table_name = 'order_items' AND column_name IN ('product_variant_id', 'color_id', 'quantity'))
        )
    `);
    const lineColumns = new Map(
      lineColumnsResult.rows.map((row) => [
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
      assert(lineColumns.get(key) === "NO", `${key} must exist and be NOT NULL.`);
    }

    const managedColumnsResult = await client.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'japan_underwear'
        AND (
          (table_name = 'products' AND column_name IN ('row_version', 'updated_at'))
          OR (table_name = 'product_colors' AND column_name IN ('row_version', 'updated_at'))
          OR (table_name = 'product_variants' AND column_name IN ('row_version', 'updated_at'))
        )
    `);
    const managedColumns = new Map(
      managedColumnsResult.rows.map((row) => [
        `${row.table_name}.${row.column_name}`,
        String(row.is_nullable),
      ]),
    );
    for (const table of ["products", "product_colors", "product_variants"]) {
      for (const column of ["row_version", "updated_at"]) {
        assert(
          managedColumns.get(`${table}.${column}`) === "NO",
          `${table}.${column} must be NOT NULL.`,
        );
      }
    }

    for (const signature of REQUIRED_FUNCTIONS) {
      const functionResult = await client.query(
        "SELECT to_regprocedure($1) AS function_name",
        [signature],
      );
      assert(functionResult.rows[0]?.function_name, `Missing function ${signature}.`);
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
    assert(
      missingMigrations.length === 0,
      `Missing Drizzle migration records: ${missingMigrations.join(", ")}.`,
    );

    console.log("Catalog DB verification OK.");
    console.log(`Tables: ${actualTables.length}.`);
    console.log("Enum: japan_underwear.catalog_import_status.");
    console.log("Product identity: brand + category + model.");
    console.log("Variant identity: product + size + cup.");
    console.log("Orderability identity: product + color + variant.");
    console.log("Historical order lines retain color and size/cup snapshots.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
