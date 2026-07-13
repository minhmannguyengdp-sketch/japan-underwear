import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
const apply = args.includes("--apply");
for (const arg of args) {
  if (arg !== inputArgument && arg !== "--apply") {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-order-data.mjs <approved.json> [--apply]",
  );
}

const inputPath = path.resolve(cwd, inputArgument);
const raw = await fs.readFile(inputPath, "utf8");
const approved = JSON.parse(raw);
if (approved.schemaVersion !== 1) throw new Error("Approved plan schemaVersion phải là 1.");
if (Number(approved.approval?.approvedVariantCandidateCount) !== 199) {
  throw new Error("Approval không xác nhận đúng 199 variant.");
}
if (Number(approved.approval?.approvedColorCandidateCount) !== 66) {
  throw new Error("Approval không xác nhận đúng 66 màu.");
}
if (!(approved.approval?.acceptedExceptions ?? []).some((value) => /9517/.test(value))) {
  throw new Error("Approval chưa chấp nhận ngoại lệ URL Pensee 9517.");
}

function parseKey(key) {
  const [brand, category, modelCode] = String(key).split(":");
  if (!brand || !category || !modelCode) throw new Error(`Product key không hợp lệ: ${key}`);
  return { brand, category, modelCode };
}

const variantRows = [];
for (const item of approved.approvedVariantCandidates ?? []) {
  const identity = parseKey(item.key);
  for (const variant of item.variants ?? []) {
    const sizeCode = String(variant.sizeCode ?? "").trim();
    const cupCode = String(variant.cupCode ?? "").trim().toUpperCase();
    if (!/^\d{2,3}$/.test(sizeCode) || !/^[A-D]$/.test(cupCode)) {
      throw new Error(`Variant không hợp lệ: ${item.key} ${sizeCode}${cupCode}`);
    }
    variantRows.push({ ...identity, sizeCode, cupCode });
  }
}

const colorRows = [];
for (const item of approved.approvedColorCandidates ?? []) {
  const identity = parseKey(item.key);
  for (const color of item.colors ?? []) {
    const code = String(color.code ?? "").trim().toLowerCase();
    const name = String(color.name ?? "").trim();
    const sortOrder = Number(color.sortOrder ?? 0);
    if (!code || !name || !Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error(`Màu không hợp lệ: ${item.key} ${code}/${name}`);
    }
    colorRows.push({ ...identity, code, name, sortOrder });
  }
}

if (variantRows.length !== 199) throw new Error(`Variant rows lệch: ${variantRows.length}/199.`);
if (colorRows.length !== 66) throw new Error(`Color rows lệch: ${colorRows.length}/66.`);

const variantKeys = new Set();
for (const row of variantRows) {
  const key = `${row.brand}:${row.category}:${row.modelCode}:${row.sizeCode}:${row.cupCode}`;
  if (variantKeys.has(key)) throw new Error(`Variant trùng: ${key}`);
  variantKeys.add(key);
}
const colorKeys = new Set();
for (const row of colorRows) {
  const key = `${row.brand}:${row.category}:${row.modelCode}:${row.code}`;
  if (colorKeys.has(key)) throw new Error(`Màu trùng: ${key}`);
  colorKeys.add(key);
}

const variantProductKeys = [...new Set(variantRows.map((row) => `${row.brand}:${row.category}:${row.modelCode}`))];
const colorProductKeys = [...new Set(colorRows.map((row) => `${row.brand}:${row.category}:${row.modelCode}`))];
const unionProductKeys = [...new Set([...variantProductKeys, ...colorProductKeys])];

console.log("=== Tuấn Thủy order-data import ===");
console.log(`Approved file: ${inputPath}`);
console.log(`Products touched: ${unionProductKeys.length}`);
console.log(`Variants: ${variantProductKeys.length} products / ${variantRows.length} rows`);
console.log(`Colors: ${colorProductKeys.length} products / ${colorRows.length} rows`);
console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
if (!apply) {
  console.log("DRY RUN: chưa ghi PostgreSQL.");
  process.exit(0);
}

const [{ config: loadEnv }, { Client }] = await Promise.all([
  import("dotenv"),
  import("pg"),
]);
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
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
  query_timeout: 300_000,
});

let runId;
let transactionStarted = false;
try {
  await client.connect();
  const schemaResult = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'product_variants'
          AND column_name = 'cup_code'
      ) AS has_cup_code,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'product_variants'
          AND column_name = 'color_id'
      ) AS has_legacy_color_id,
      to_regclass('japan_underwear.product_variants_product_size_cup_uidx') AS cup_index,
      to_regclass('japan_underwear.product_colors_product_code_uidx') AS color_index
  `);
  const schema = schemaResult.rows[0];
  if (!schema.has_cup_code || schema.has_legacy_color_id || !schema.cup_index || !schema.color_index) {
    throw new Error("Schema order variant chưa sẵn sàng. Chạy npm run db:migrate rồi npm run db:verify.");
  }

  const productResult = await client.query(`
    SELECT brand.slug AS brand, category.slug AS category, product.model_code, product.id
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true
  `);
  const productIdByKey = new Map(
    productResult.rows.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      String(row.id),
    ]),
  );
  const missingProducts = unionProductKeys.filter((key) => !productIdByKey.has(key));
  if (missingProducts.length) {
    throw new Error(`Approved data có product không tồn tại/không active: ${missingProducts.join(", ")}`);
  }

  const inputHash = crypto.createHash("sha256").update(raw).digest("hex");
  const run = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "tuan-thuy-approved-order-data",
      inputHash,
      JSON.stringify({
        plannedProducts: unionProductKeys.length,
        plannedVariants: variantRows.length,
        plannedColors: colorRows.length,
      }),
    ],
  );
  runId = run.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:order-data-import'))",
  );

  const variantProductIds = variantProductKeys.map((key) => productIdByKey.get(key));
  const colorProductIds = colorProductKeys.map((key) => productIdByKey.get(key));
  const unionProductIds = unionProductKeys.map((key) => productIdByKey.get(key));

  await client.query(
    `UPDATE japan_underwear.product_variants SET is_active = false, updated_at = now() WHERE product_id = ANY($1::uuid[])`,
    [unionProductIds],
  );
  await client.query(
    `UPDATE japan_underwear.product_colors SET is_active = false WHERE product_id = ANY($1::uuid[])`,
    [unionProductIds],
  );

  const variantsWithIds = variantRows.map((row) => ({
    product_id: productIdByKey.get(`${row.brand}:${row.category}:${row.modelCode}`),
    size_code: row.sizeCode,
    cup_code: row.cupCode,
  }));
  await client.query(
    `
      INSERT INTO japan_underwear.product_variants
        (product_id, size_code, cup_code, sku, price_override, is_active, updated_at)
      SELECT input.product_id, input.size_code, input.cup_code, NULL, NULL, true, now()
      FROM jsonb_to_recordset($1::jsonb)
        AS input(product_id uuid, size_code text, cup_code text)
      ON CONFLICT (product_id, size_code, cup_code) WHERE cup_code IS NOT NULL
      DO UPDATE SET is_active = true, updated_at = now()
    `,
    [JSON.stringify(variantsWithIds)],
  );

  const colorsWithIds = colorRows.map((row) => ({
    product_id: productIdByKey.get(`${row.brand}:${row.category}:${row.modelCode}`),
    code: row.code,
    name: row.name,
    sort_order: row.sortOrder,
  }));
  await client.query(
    `
      INSERT INTO japan_underwear.product_colors
        (product_id, code, name, sort_order, is_active)
      SELECT input.product_id, input.code, input.name, input.sort_order, true
      FROM jsonb_to_recordset($1::jsonb)
        AS input(product_id uuid, code text, name text, sort_order integer)
      ON CONFLICT (product_id, code)
      DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        is_active = true
    `,
    [JSON.stringify(colorsWithIds)],
  );

  const checkResult = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_variants
          WHERE product_id = ANY($1::uuid[]) AND is_active = true
        ) AS variants,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_colors
          WHERE product_id = ANY($2::uuid[]) AND is_active = true
        ) AS colors,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products AS product
          WHERE product.id = ANY($3::uuid[])
            AND EXISTS (
              SELECT 1 FROM japan_underwear.product_variants AS variant
              WHERE variant.product_id = product.id AND variant.is_active = true
            )
            AND EXISTS (
              SELECT 1 FROM japan_underwear.product_colors AS color
              WHERE color.product_id = product.id AND color.is_active = true
            )
        ) AS orderable_products
    `,
    [variantProductIds, colorProductIds, unionProductIds],
  );
  const checked = checkResult.rows[0];
  if (Number(checked.variants) !== 199 || Number(checked.colors) !== 66 || Number(checked.orderable_products) !== 2) {
    throw new Error(
      `Hậu kiểm thất bại: variants=${checked.variants}/199, colors=${checked.colors}/66, orderable=${checked.orderable_products}/2.`,
    );
  }

  await client.query("COMMIT");
  transactionStarted = false;
  await client.query(
    `
      UPDATE japan_underwear.catalog_import_runs
      SET status = 'completed',
          summary = $2::jsonb,
          finished_at = now(),
          error_message = NULL
      WHERE id = $1
    `,
    [
      runId,
      JSON.stringify({
        importedProducts: unionProductKeys.length,
        importedVariants: 199,
        importedColors: 66,
        orderableProducts: 2,
      }),
    ],
  );

  console.log("Import order data OK.");
  console.log("Variants: 199. Colors: 66. Immediately orderable products: 2.");
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
  if (runId) {
    await client.query(
      `
        UPDATE japan_underwear.catalog_import_runs
        SET status = 'failed', error_message = $2, finished_at = now()
        WHERE id = $1
      `,
      [runId, error instanceof Error ? error.message : String(error)],
    ).catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
