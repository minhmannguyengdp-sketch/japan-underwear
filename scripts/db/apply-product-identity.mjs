import crypto from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";

const BASELINE_CREATED_AT = 1783842973000;
const ENUM_MIGRATION_CREATED_AT = 1783845000000;
const PRODUCT_IDENTITY_CREATED_AT = 1783849000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0002_product_identity_by_category.sql",
  import.meta.url,
);

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is required.");
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
  ssl: isLocalDatabase(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

function formatPgError(error) {
  if (!(error instanceof Error)) return String(error);

  const details = [error.message];
  if (error.code) details.push(`code=${error.code}`);
  if (error.detail) details.push(`detail=${error.detail}`);
  if (error.constraint) details.push(`constraint=${error.constraint}`);
  if (error.table) details.push(`table=${error.table}`);
  return details.join(" | ");
}

async function assertRequiredState() {
  const tableResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products,
      to_regclass('japan_underwear.brands') AS brands,
      to_regclass('japan_underwear.categories') AS categories,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);

  const state = tableResult.rows[0];
  const missing = Object.entries(state)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Thiếu cấu trúc bắt buộc: ${missing.join(", ")}.`);
  }

  const requiredMigrationResult = await client.query(
    `
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      WHERE created_at = ANY($1::bigint[])
    `,
    [[BASELINE_CREATED_AT, ENUM_MIGRATION_CREATED_AT]],
  );

  const applied = new Set(
    requiredMigrationResult.rows.map((row) => Number(row.created_at)),
  );
  const missingMigrations = [BASELINE_CREATED_AT, ENUM_MIGRATION_CREATED_AT].filter(
    (createdAt) => !applied.has(createdAt),
  );

  if (missingMigrations.length > 0) {
    throw new Error(
      `Thiếu migration nền trước 0002: ${missingMigrations.join(", ")}.`,
    );
  }

  const nullCategoryResult = await client.query(`
    SELECT id, model_code
    FROM japan_underwear.products
    WHERE category_id IS NULL
    ORDER BY created_at, id
    LIMIT 10
  `);

  if (nullCategoryResult.rowCount > 0) {
    const sample = nullCategoryResult.rows
      .map((row) => `${row.id}:${row.model_code}`)
      .join(", ");
    throw new Error(
      `Không thể bắt buộc category_id vì còn product thiếu category. Mẫu: ${sample}.`,
    );
  }

  const duplicateResult = await client.query(`
    SELECT brand_id, category_id, model_code, COUNT(*)::integer AS count
    FROM japan_underwear.products
    GROUP BY brand_id, category_id, model_code
    HAVING COUNT(*) > 1
    ORDER BY count DESC, model_code
    LIMIT 10
  `);

  if (duplicateResult.rowCount > 0) {
    const sample = duplicateResult.rows
      .map(
        (row) =>
          `${row.brand_id}/${row.category_id}/${row.model_code} x${row.count}`,
      )
      .join(", ");
    throw new Error(
      `Không thể tạo khóa brand + category + model vì có dữ liệu trùng: ${sample}.`,
    );
  }
}

async function verifyAppliedState() {
  const columnResult = await client.query(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'products'
      AND column_name = 'category_id'
  `);

  if (
    columnResult.rowCount !== 1 ||
    columnResult.rows[0].is_nullable !== "NO"
  ) {
    throw new Error("Hậu kiểm thất bại: products.category_id vẫn nullable.");
  }

  const indexResult = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'japan_underwear'
      AND indexname IN (
        'products_brand_model_uidx',
        'products_brand_category_model_uidx'
      )
    ORDER BY indexname
  `);

  const indexes = new Set(indexResult.rows.map((row) => row.indexname));
  if (indexes.has("products_brand_model_uidx")) {
    throw new Error("Hậu kiểm thất bại: unique index brand + model vẫn còn.");
  }
  if (!indexes.has("products_brand_category_model_uidx")) {
    throw new Error(
      "Hậu kiểm thất bại: thiếu unique index brand + category + model.",
    );
  }

  const fkResult = await client.query(`
    SELECT constraint_definition.confdeltype AS delete_action
    FROM pg_constraint AS constraint_definition
    JOIN pg_class AS table_definition
      ON table_definition.oid = constraint_definition.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_definition.relnamespace
    WHERE namespace.nspname = 'japan_underwear'
      AND table_definition.relname = 'products'
      AND constraint_definition.conname = 'products_category_id_categories_id_fk'
      AND constraint_definition.contype = 'f'
  `);

  if (fkResult.rowCount !== 1 || fkResult.rows[0].delete_action !== "r") {
    throw new Error(
      "Hậu kiểm thất bại: foreign key category chưa dùng ON DELETE RESTRICT.",
    );
  }
}

async function main() {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationHash = crypto
    .createHash("sha256")
    .update(migrationSql)
    .digest("hex");

  await client.connect();
  await client.query("BEGIN");

  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:product-identity-migration'))",
    );

    console.log("  - Kiểm tra dữ liệu và migration nền...");
    await assertRequiredState();

    console.log("  - Chuẩn hóa slug và source_product_id...");
    await client.query(`
      UPDATE japan_underwear.products AS product
      SET
        slug = identity.brand_slug || '-' || identity.category_slug || '-' || product.model_code,
        source_product_id = 'local:' || identity.brand_slug || ':' || identity.category_slug || ':' || product.model_code,
        updated_at = now()
      FROM (
        SELECT
          product_identity.id,
          brand.slug AS brand_slug,
          category.slug AS category_slug
        FROM japan_underwear.products AS product_identity
        JOIN japan_underwear.brands AS brand
          ON brand.id = product_identity.brand_id
        JOIN japan_underwear.categories AS category
          ON category.id = product_identity.category_id
      ) AS identity
      WHERE identity.id = product.id
    `);

    console.log("  - Bắt buộc category và chuẩn hóa foreign key...");
    await client.query(`
      ALTER TABLE japan_underwear.products
        ALTER COLUMN category_id SET NOT NULL
    `);
    await client.query(`
      ALTER TABLE japan_underwear.products
        DROP CONSTRAINT IF EXISTS products_category_id_categories_id_fk
    `);
    await client.query(`
      ALTER TABLE japan_underwear.products
        ADD CONSTRAINT products_category_id_categories_id_fk
        FOREIGN KEY (category_id)
        REFERENCES japan_underwear.categories(id)
        ON DELETE RESTRICT
        ON UPDATE NO ACTION
    `);

    console.log("  - Thay unique key brand + model bằng brand + category + model...");
    await client.query(`
      DROP INDEX IF EXISTS japan_underwear.products_brand_model_uidx
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_brand_category_model_uidx
      ON japan_underwear.products (brand_id, category_id, model_code)
    `);

    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal...");
    await client.query(
      `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
      [PRODUCT_IDENTITY_CREATED_AT],
    );
    await client.query(
      `
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES ($1, $2)
      `,
      [migrationHash, PRODUCT_IDENTITY_CREATED_AT],
    );

    await client.query("COMMIT");
    console.log("Product identity migration OK.");
    console.log("Identity: brand + category + model.");
    console.log("Migration record 0002 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Product identity migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
