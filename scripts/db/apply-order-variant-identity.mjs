import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const BASELINE_CREATED_AT = 1783842973000;
const ENUM_MIGRATION_CREATED_AT = 1783845000000;
const PRODUCT_IDENTITY_CREATED_AT = 1783849000000;
const ORDER_VARIANT_CREATED_AT = 1783853000000;
const MIGRATION_PATH = new URL(
  "../../drizzle/0003_order_variant_identity.sql",
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

function formatPgError(error) {
  if (!(error instanceof Error)) return String(error);
  const details = [error.message];
  if (error.code) details.push(`code=${error.code}`);
  if (error.detail) details.push(`detail=${error.detail}`);
  if (error.constraint) details.push(`constraint=${error.constraint}`);
  if (error.table) details.push(`table=${error.table}`);
  return details.join(" | ");
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});

async function columnExists(tableName, columnName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function assertRequiredState() {
  const tableResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.product_variants') AS product_variants,
      to_regclass('japan_underwear.product_colors') AS product_colors,
      to_regclass('japan_underwear.products') AS products,
      to_regclass('drizzle.__drizzle_migrations') AS migration_journal
  `);
  const state = tableResult.rows[0];
  const missing = Object.entries(state)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Thiếu cấu trúc bắt buộc: ${missing.join(", ")}.`);
  }

  const required = [
    BASELINE_CREATED_AT,
    ENUM_MIGRATION_CREATED_AT,
    PRODUCT_IDENTITY_CREATED_AT,
  ];
  const migrationResult = await client.query(
    `
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      WHERE created_at = ANY($1::bigint[])
    `,
    [required],
  );
  const applied = new Set(
    migrationResult.rows.map((row) => Number(row.created_at)),
  );
  const missingMigrations = required.filter((createdAt) => !applied.has(createdAt));
  if (missingMigrations.length) {
    throw new Error(
      `Thiếu migration nền trước 0003: ${missingMigrations.join(", ")}.`,
    );
  }

  const hasLegacyColorId = await columnExists("product_variants", "color_id");
  const variantCountResult = await client.query(
    "SELECT COUNT(*)::integer AS count FROM japan_underwear.product_variants",
  );
  const variantCount = Number(variantCountResult.rows[0]?.count ?? 0);

  if (hasLegacyColorId && variantCount > 0) {
    const sampleResult = await client.query(`
      SELECT
        variant.id,
        product.model_code,
        variant.size_code,
        color.code AS color_code
      FROM japan_underwear.product_variants AS variant
      LEFT JOIN japan_underwear.products AS product ON product.id = variant.product_id
      LEFT JOIN japan_underwear.product_colors AS color ON color.id = variant.color_id
      ORDER BY product.model_code, variant.size_code, variant.id
      LIMIT 10
    `);
    const sample = sampleResult.rows
      .map(
        (row) =>
          `${row.model_code ?? "?"}:${row.color_code ?? "?"}:${row.size_code ?? "?"}`,
      )
      .join(", ");
    throw new Error(
      `Không thể tự bỏ color_id vì product_variants còn ${variantCount} dòng legacy. Mẫu: ${sample || "không đọc được"}.`,
    );
  }

  const invalidColorResult = await client.query(`
    SELECT product_id, code, name
    FROM japan_underwear.product_colors
    WHERE btrim(code) = '' OR btrim(name) = ''
    LIMIT 10
  `);
  if (invalidColorResult.rowCount > 0) {
    const sample = invalidColorResult.rows
      .map((row) => `${row.product_id}:${row.code}/${row.name}`)
      .join(", ");
    throw new Error(`product_colors có code/name rỗng: ${sample}.`);
  }

  if (!hasLegacyColorId && variantCount > 0) {
    const invalidVariantResult = await client.query(`
      SELECT id, product_id, size_code, cup_code, price_override
      FROM japan_underwear.product_variants
      WHERE btrim(size_code) = ''
         OR (cup_code IS NOT NULL AND cup_code !~ '^[A-Z]+$')
         OR (price_override IS NOT NULL AND price_override < 0)
      LIMIT 10
    `);
    if (invalidVariantResult.rowCount > 0) {
      const sample = invalidVariantResult.rows
        .map((row) => `${row.product_id}:${row.size_code}:${row.cup_code ?? "-"}`)
        .join(", ");
      throw new Error(`product_variants có dữ liệu không hợp lệ: ${sample}.`);
    }

    const duplicateResult = await client.query(`
      SELECT product_id, size_code, cup_code, COUNT(*)::integer AS count
      FROM japan_underwear.product_variants
      GROUP BY product_id, size_code, cup_code
      HAVING COUNT(*) > 1
      ORDER BY count DESC, product_id, size_code, cup_code
      LIMIT 10
    `);
    if (duplicateResult.rowCount > 0) {
      const sample = duplicateResult.rows
        .map(
          (row) =>
            `${row.product_id}:${row.size_code}:${row.cup_code ?? "-"} x${row.count}`,
        )
        .join(", ");
      throw new Error(`product_variants trùng khóa product + size + cup: ${sample}.`);
    }
  }

  return { hasLegacyColorId, variantCount };
}

async function applyTargetState() {
  await client.query(
    'DROP INDEX IF EXISTS japan_underwear.product_variants_product_color_size_uidx',
  );
  await client.query(
    'DROP INDEX IF EXISTS japan_underwear.product_variants_color_idx',
  );
  await client.query(`
    ALTER TABLE japan_underwear.product_variants
      DROP CONSTRAINT IF EXISTS product_variants_color_id_product_colors_id_fk
  `);
  await client.query(`
    ALTER TABLE japan_underwear.product_variants
      DROP COLUMN IF EXISTS color_id
  `);
  await client.query(`
    ALTER TABLE japan_underwear.product_variants
      ADD COLUMN IF NOT EXISTS cup_code text
  `);

  await client.query(`
    ALTER TABLE japan_underwear.product_colors
      DROP CONSTRAINT IF EXISTS product_colors_code_nonempty_chk,
      DROP CONSTRAINT IF EXISTS product_colors_name_nonempty_chk
  `);
  await client.query(`
    ALTER TABLE japan_underwear.product_colors
      ADD CONSTRAINT product_colors_code_nonempty_chk CHECK (btrim(code) <> ''),
      ADD CONSTRAINT product_colors_name_nonempty_chk CHECK (btrim(name) <> '')
  `);

  await client.query(`
    ALTER TABLE japan_underwear.product_variants
      DROP CONSTRAINT IF EXISTS product_variants_size_nonempty_chk,
      DROP CONSTRAINT IF EXISTS product_variants_cup_format_chk,
      DROP CONSTRAINT IF EXISTS product_variants_price_override_nonnegative_chk
  `);
  await client.query(`
    ALTER TABLE japan_underwear.product_variants
      ADD CONSTRAINT product_variants_size_nonempty_chk CHECK (btrim(size_code) <> ''),
      ADD CONSTRAINT product_variants_cup_format_chk CHECK (cup_code IS NULL OR cup_code ~ '^[A-Z]+$'),
      ADD CONSTRAINT product_variants_price_override_nonnegative_chk CHECK (price_override IS NULL OR price_override >= 0)
  `);

  await client.query(
    'DROP INDEX IF EXISTS japan_underwear.product_variants_product_size_cup_uidx',
  );
  await client.query(
    'DROP INDEX IF EXISTS japan_underwear.product_variants_product_size_no_cup_uidx',
  );
  await client.query(`
    CREATE UNIQUE INDEX product_variants_product_size_cup_uidx
      ON japan_underwear.product_variants (product_id, size_code, cup_code)
      WHERE cup_code IS NOT NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX product_variants_product_size_no_cup_uidx
      ON japan_underwear.product_variants (product_id, size_code)
      WHERE cup_code IS NULL
  `);
}

async function verifyAppliedState() {
  const columnResult = await client.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'japan_underwear'
      AND table_name = 'product_variants'
      AND column_name IN ('color_id', 'size_code', 'cup_code')
    ORDER BY column_name
  `);
  const columns = new Map(
    columnResult.rows.map((row) => [row.column_name, row.is_nullable]),
  );
  if (columns.has("color_id")) {
    throw new Error("Hậu kiểm thất bại: product_variants.color_id vẫn tồn tại.");
  }
  if (columns.get("size_code") !== "NO") {
    throw new Error("Hậu kiểm thất bại: product_variants.size_code không phải NOT NULL.");
  }
  if (columns.get("cup_code") !== "YES") {
    throw new Error("Hậu kiểm thất bại: product_variants.cup_code chưa nullable.");
  }

  const indexResult = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'japan_underwear'
      AND indexname IN (
        'product_variants_product_color_size_uidx',
        'product_variants_color_idx',
        'product_variants_product_size_cup_uidx',
        'product_variants_product_size_no_cup_uidx'
      )
  `);
  const indexes = new Set(indexResult.rows.map((row) => row.indexname));
  if (
    indexes.has("product_variants_product_color_size_uidx") ||
    indexes.has("product_variants_color_idx")
  ) {
    throw new Error("Hậu kiểm thất bại: index variant gắn màu vẫn còn.");
  }
  if (
    !indexes.has("product_variants_product_size_cup_uidx") ||
    !indexes.has("product_variants_product_size_no_cup_uidx")
  ) {
    throw new Error("Hậu kiểm thất bại: thiếu unique index product + size + cup.");
  }
}

async function reconcileJournal(migrationHash) {
  const laterResult = await client.query(
    `
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      WHERE created_at > $1
      ORDER BY created_at
    `,
    [ORDER_VARIANT_CREATED_AT],
  );
  if (laterResult.rowCount > 0) {
    console.log(
      `  - Journal có ${laterResult.rowCount} mốc mới hơn 0003; giữ nguyên và reconcile riêng 0003.`,
    );
  }

  await client.query(
    "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1",
    [ORDER_VARIANT_CREATED_AT],
  );
  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [migrationHash, ORDER_VARIANT_CREATED_AT],
  );
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
      "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:order-variant-identity-migration'))",
    );

    console.log("  - Kiểm tra schema, migration nền và dữ liệu legacy...");
    const state = await assertRequiredState();
    console.log(
      `  - product_variants: ${state.variantCount} dòng; legacy color_id: ${state.hasLegacyColorId ? "có" : "không"}.`,
    );

    console.log("  - Chuẩn hóa variant thành product + size + cup...");
    await applyTargetState();
    await verifyAppliedState();

    console.log("  - Reconcile Drizzle migration journal cho 0003...");
    await reconcileJournal(migrationHash);

    await client.query("COMMIT");
    console.log("Order variant identity migration OK.");
    console.log("Variant identity: product + size + cup.");
    console.log("Order line identity: product + color + size + cup.");
    console.log("Migration record 0003 reconciled.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Order variant identity migration failed: ${formatPgError(error)}`);
  process.exit(1);
});
