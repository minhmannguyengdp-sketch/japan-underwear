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
    "Usage: node scripts/catalog/import-tuan-thuy-reviewed-colors.mjs <approved-colors.json> [--apply]",
  );
}

const inputPath = path.resolve(cwd, inputArgument);
const raw = await fs.readFile(inputPath, "utf8");
const approved = JSON.parse(raw);
if (approved.schemaVersion !== 1) {
  throw new Error(`Approved colors schemaVersion phải là 1; nhận ${approved.schemaVersion}.`);
}
if (Number(approved.approval?.approvedProductCount) !== 30) {
  throw new Error("Approved colors phải có đúng 30 product baseline đang thiếu màu.");
}
if (Number(approved.sourceApprovedOrderData?.approvedVariantCandidateCount) !== 199) {
  throw new Error("Approved colors không còn liên kết với đúng 199 size/cup đã duyệt.");
}
if (!approved.approval?.preservesApprovedVariantPayloadSha256) {
  throw new Error("Approved colors thiếu hash khóa payload size/cup.");
}

function parseKey(key) {
  const [brand, category, modelCode] = String(key).split(":");
  if (!brand || !category || !modelCode) throw new Error(`Product key không hợp lệ: ${key}`);
  return { brand, category, modelCode };
}

const productRows = [];
const colorRows = [];
const productKeys = new Set();
const colorKeys = new Set();
for (const item of approved.approvedProducts ?? []) {
  const key = String(item.key ?? "").trim();
  const identity = parseKey(key);
  if (productKeys.has(key)) throw new Error(`Product trùng: ${key}`);
  productKeys.add(key);
  const sourceUrls = [...new Set((item.sourceUrls ?? []).map(String).filter(Boolean))];
  if (sourceUrls.length === 0) throw new Error(`Product ${key} thiếu source URL.`);
  const colors = item.colors ?? [];
  if (colors.length === 0) throw new Error(`Product ${key} không có màu.`);
  productRows.push({ key, ...identity, sourceUrls });
  for (const color of colors) {
    const code = String(color.code ?? "").trim().toLowerCase();
    const name = String(color.name ?? "").trim();
    const sortOrder = Number(color.sortOrder);
    if (!code || !name || !Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error(`Màu không hợp lệ: ${key} ${code}/${name}/${sortOrder}`);
    }
    if (!(color.evidenceUrls ?? []).length || !(color.evidenceTypes ?? []).length) {
      throw new Error(`Màu ${key}:${code} thiếu bằng chứng web.`);
    }
    const uniqueKey = `${key}:${code}`;
    if (colorKeys.has(uniqueKey)) throw new Error(`Màu trùng: ${uniqueKey}`);
    colorKeys.add(uniqueKey);
    colorRows.push({ key, ...identity, code, name, sortOrder });
  }
}

if (productRows.length !== 30) throw new Error(`Product rows lệch: ${productRows.length}/30.`);
if (colorRows.length !== Number(approved.approval.approvedColorCount)) {
  throw new Error(
    `Color rows lệch: ${colorRows.length}/${approved.approval.approvedColorCount}.`,
  );
}

console.log("=== Tuấn Thủy reviewed-color import ===");
console.log(`Approved file: ${inputPath}`);
console.log(`Products: ${productRows.length}`);
console.log(`Colors: ${colorRows.length}`);
console.log("Size/cup: preserved exactly; this importer never updates product_variants.");
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
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.product_variants') AS variants_table,
      to_regclass('japan_underwear.product_colors') AS colors_table,
      to_regclass('japan_underwear.catalog_import_runs') AS runs_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'product_colors'
          AND column_name = 'row_version'
      ) AS has_color_row_version
  `);
  const schema = schemaResult.rows[0];
  if (
    !schema.products_table ||
    !schema.variants_table ||
    !schema.colors_table ||
    !schema.runs_table ||
    !schema.has_color_row_version
  ) {
    throw new Error("Schema catalog chưa sẵn sàng. Chạy npm run db:migrate rồi npm run db:verify.");
  }

  const productResult = await client.query(`
    SELECT
      brand.slug AS brand,
      category.slug AS category,
      product.model_code,
      product.id,
      EXISTS (
        SELECT 1
        FROM japan_underwear.product_variants AS variant
        WHERE variant.product_id = product.id AND variant.is_active = true
      ) AS has_active_variant
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true
  `);
  const productByKey = new Map(
    productResult.rows.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      { id: String(row.id), hasActiveVariant: Boolean(row.has_active_variant) },
    ]),
  );
  const missingProducts = productRows.filter((row) => !productByKey.has(row.key));
  if (missingProducts.length) {
    throw new Error(
      `Approved colors có product không tồn tại/không active: ${missingProducts.map((row) => row.key).join(", ")}`,
    );
  }
  const withoutVariants = productRows.filter(
    (row) => !productByKey.get(row.key)?.hasActiveVariant,
  );
  if (withoutVariants.length) {
    throw new Error(
      `Product không còn size/cup active: ${withoutVariants.map((row) => row.key).join(", ")}`,
    );
  }

  const productIds = productRows.map((row) => productByKey.get(row.key).id);
  const existingColorsResult = await client.query(
    `
      SELECT product_id, code, name, sort_order, is_active
      FROM japan_underwear.product_colors
      WHERE product_id = ANY($1::uuid[])
    `,
    [productIds],
  );
  const approvedCodesByProductId = new Map();
  for (const row of colorRows) {
    const productId = productByKey.get(row.key).id;
    const codes = approvedCodesByProductId.get(productId) ?? new Set();
    codes.add(row.code);
    approvedCodesByProductId.set(productId, codes);
  }
  const unexpectedActiveColors = existingColorsResult.rows.filter(
    (row) =>
      row.is_active &&
      !approvedCodesByProductId.get(String(row.product_id))?.has(String(row.code)),
  );
  if (unexpectedActiveColors.length) {
    throw new Error(
      `Target đã có màu active ngoài manifest: ${unexpectedActiveColors
        .map((row) => `${row.product_id}:${row.code}`)
        .join(", ")}`,
    );
  }

  const beforeTargetResult = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM japan_underwear.products AS product
      WHERE product.id = ANY($1::uuid[])
        AND EXISTS (
          SELECT 1 FROM japan_underwear.product_variants AS variant
          WHERE variant.product_id = product.id AND variant.is_active = true
        )
        AND EXISTS (
          SELECT 1 FROM japan_underwear.product_colors AS color
          WHERE color.product_id = product.id AND color.is_active = true
        )
    `,
    [productIds],
  );
  const beforeOrderableTargets = Number(beforeTargetResult.rows[0].count);

  const inputHash = crypto.createHash("sha256").update(raw).digest("hex");
  const run = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "tuan-thuy-reviewed-color-audit",
      inputHash,
      JSON.stringify({
        plannedProducts: productRows.length,
        plannedColors: colorRows.length,
        preservedVariantPayloadSha256:
          approved.approval.preservesApprovedVariantPayloadSha256,
      }),
    ],
  );
  runId = run.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:reviewed-color-import'))",
  );
  const requestId = crypto.randomUUID();
  await client.query(
    "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
    ["catalog-color-audit-import"],
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
    [requestId],
  );

  const colorsWithIds = colorRows.map((row) => ({
    product_id: productByKey.get(row.key).id,
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

  const afterResult = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_colors AS color
          WHERE color.product_id = ANY($1::uuid[])
            AND color.is_active = true
            AND (color.product_id, color.code) IN (
              SELECT input.product_id, input.code
              FROM jsonb_to_recordset($2::jsonb)
                AS input(product_id uuid, code text)
            )
        ) AS approved_colors,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products AS product
          WHERE product.id = ANY($1::uuid[])
            AND EXISTS (
              SELECT 1 FROM japan_underwear.product_variants AS variant
              WHERE variant.product_id = product.id AND variant.is_active = true
            )
            AND EXISTS (
              SELECT 1 FROM japan_underwear.product_colors AS color
              WHERE color.product_id = product.id AND color.is_active = true
            )
        ) AS orderable_targets
    `,
    [
      productIds,
      JSON.stringify(colorsWithIds.map(({ product_id, code }) => ({ product_id, code }))),
    ],
  );
  const checked = afterResult.rows[0];
  if (Number(checked.approved_colors) !== colorRows.length) {
    throw new Error(
      `Hậu kiểm màu thất bại: ${checked.approved_colors}/${colorRows.length}.`,
    );
  }
  if (Number(checked.orderable_targets) !== productRows.length) {
    throw new Error(
      `Hậu kiểm product đặt được thất bại: ${checked.orderable_targets}/${productRows.length}.`,
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
        importedProducts: productRows.length,
        importedColors: colorRows.length,
        orderableTargetsBefore: beforeOrderableTargets,
        orderableTargetsAfter: productRows.length,
        preservedVariantPayloadSha256:
          approved.approval.preservesApprovedVariantPayloadSha256,
      }),
    ],
  );

  console.log("Import màu đã duyệt OK.");
  console.log(`Colors: ${colorRows.length}. Orderable target products: ${productRows.length}.`);
  console.log("product_variants không bị update.");
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
  if (runId) {
    await client
      .query(
        `
          UPDATE japan_underwear.catalog_import_runs
          SET status = 'failed', error_message = $2, finished_at = now()
          WHERE id = $1
        `,
        [runId, error instanceof Error ? error.message : String(error)],
      )
      .catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
