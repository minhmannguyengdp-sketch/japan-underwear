import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const validateOnly = args.includes("--validate-only");
const positional = args.filter((arg) => !arg.startsWith("--"));

if (apply && validateOnly) {
  throw new Error("Không được dùng đồng thời --apply và --validate-only.");
}
if (positional.length !== 1) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-owner-color-supplement.mjs <owner-color-supplement.json> [--validate-only|--apply]",
  );
}
for (const arg of args) {
  if (!["--apply", "--validate-only"].includes(arg) && !positional.includes(arg)) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}

const manifestPath = path.resolve(cwd, positional[0]);
const manifestRaw = await fs.readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

const EXPECTED_KEYS = [
  "pensee:ao-nguc:9512",
  "pensee:ao-nguc:9536",
  "winking:ao-nguc:5002",
  "winking:ao-nguc:5003",
].sort();

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) throw new Error(`Product key không hợp lệ: ${key}`);
  return { brand, category, modelCode };
}

function validateManifest() {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Owner supplement schemaVersion phải là 1; nhận ${manifest.schemaVersion}.`);
  }

  const source = manifest.sourceOwnerConfirmation ?? {};
  if (!clean(source.confirmedBy) || !clean(source.confirmedAt) || !clean(source.confirmationText)) {
    throw new Error("Owner supplement thiếu người xác nhận, thời điểm hoặc nội dung xác nhận.");
  }

  const rules = manifest.businessRules ?? {};
  if (
    !rules.colorSetCompletenessVerifiedPerListedProduct ||
    !rules.ownerConfirmationIsExplicitColorList ||
    !rules.noDescriptionWrite ||
    !rules.noVariantWrite ||
    !rules.noPriceWrite ||
    !rules.noProductCreation
  ) {
    throw new Error("Owner supplement thiếu quy tắc bảo toàn dữ liệu bắt buộc.");
  }

  const products = manifest.products ?? [];
  if (products.length !== 4 || Number(manifest.summary?.productCount) !== 4) {
    throw new Error(`Owner supplement phải có đúng 4 product; nhận ${products.length}.`);
  }

  const actualKeys = products.map((product) => clean(product.key)).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error(`Owner supplement lệch đúng bốn mã cần bổ sung: ${actualKeys.join(", ")}.`);
  }

  let colorCount = 0;
  const seenKeys = new Set();
  for (const product of products) {
    const key = clean(product.key);
    const identity = parseKey(key);
    if (seenKeys.has(key)) throw new Error(`Product trùng: ${key}.`);
    seenKeys.add(key);

    if (identity.category !== "ao-nguc" || !["pensee", "winking"].includes(identity.brand)) {
      throw new Error(`Identity không hợp lệ: ${key}.`);
    }
    if (!/^\d{4}$/.test(identity.modelCode)) throw new Error(`Model code không hợp lệ: ${key}.`);
    if (
      clean(product.brand) !== identity.brand ||
      clean(product.category) !== identity.category ||
      clean(product.modelCode) !== identity.modelCode
    ) {
      throw new Error(`Identity object không khớp key: ${key}.`);
    }
    if (product.shortDescription !== null && product.shortDescription !== undefined) {
      throw new Error(`Product ${key} không được mang mô tả trong owner color supplement.`);
    }
    if (product.colorSetComplete !== true) {
      throw new Error(`Product ${key} chưa xác nhận bộ màu đầy đủ.`);
    }
    if (!(product.completenessEvidenceTypes ?? []).includes("catalog-owner-confirmed-color-list")) {
      throw new Error(`Product ${key} thiếu bằng chứng xác nhận màu của chủ catalog.`);
    }
    if (!(product.completenessEvidenceTexts ?? []).length) {
      throw new Error(`Product ${key} thiếu nội dung xác nhận màu.`);
    }

    const colors = product.colors ?? [];
    if (colors.length === 0) throw new Error(`Product ${key} không có màu.`);
    const seenCodes = new Set();
    for (const [index, color] of colors.entries()) {
      const code = clean(color.code).toLowerCase();
      const name = clean(color.name);
      const sortOrder = Number(color.sortOrder);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || !name) {
        throw new Error(`Màu không hợp lệ: ${key} ${code}/${name}.`);
      }
      if (seenCodes.has(code)) throw new Error(`Màu trùng: ${key}:${code}.`);
      seenCodes.add(code);
      if (sortOrder !== index) {
        throw new Error(`sortOrder phải liên tục từ 0: ${key}:${code}:${sortOrder}/${index}.`);
      }
      if (clean(color.evidenceType) !== "catalog-owner-confirmed-color-list") {
        throw new Error(`Màu ${key}:${code} thiếu evidenceType của chủ catalog.`);
      }
      colorCount += 1;
    }
  }

  if (colorCount !== 12 || Number(manifest.summary?.colorCount) !== 12) {
    throw new Error(`Owner supplement phải có đúng 12 màu; nhận ${colorCount}.`);
  }
  if (
    Number(manifest.summary?.targetProductsCovered) !== 4 ||
    Number(manifest.summary?.targetProductsStillMissing) !== 0
  ) {
    throw new Error("Owner supplement phải phủ đủ bốn mã còn thiếu.");
  }

  return {
    products,
    colorCount,
    manifestHash: sha256(manifestRaw),
    confirmedBy: clean(source.confirmedBy),
    confirmedAt: clean(source.confirmedAt),
    confirmationHash: sha256(clean(source.confirmationText)),
  };
}

const validated = validateManifest();
console.log("=== Tuấn Thủy owner color supplement ===");
console.log(`Manifest: ${manifestPath}`);
console.log(`Products: ${validated.products.length}`);
console.log(`Colors: ${validated.colorCount}`);
console.log(`Confirmed by: ${validated.confirmedBy}`);
console.log("Descriptions, prices and product_variants: không cập nhật.");

if (validateOnly) {
  console.log("VALIDATE ONLY: owner supplement hợp lệ; chưa kết nối PostgreSQL.");
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

async function readVariantSnapshot() {
  const result = await client.query(`
    SELECT
      id::text,
      product_id::text,
      size_code,
      COALESCE(cup_code, '') AS cup_code,
      COALESCE(sku, '') AS sku,
      COALESCE(price_override::text, '') AS price_override,
      is_active
    FROM japan_underwear.product_variants
    ORDER BY product_id, size_code, cup_code, id
  `);
  return result.rows;
}

let runId;
let transactionStarted = false;
try {
  await client.connect();

  const productResult = await client.query(`
    SELECT
      product.id::text,
      brand.slug AS brand,
      category.slug AS category,
      product.model_code,
      EXISTS (
        SELECT 1
        FROM japan_underwear.product_variants AS variant
        WHERE variant.product_id = product.id
          AND variant.is_active = true
      ) AS has_active_variant
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true
      AND category.slug = 'ao-nguc'
  `);
  const productByKey = new Map(
    productResult.rows.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      row,
    ]),
  );

  const missingProducts = validated.products
    .map((product) => clean(product.key))
    .filter((key) => !productByKey.has(key));
  if (missingProducts.length) {
    throw new Error(`Bốn mã bổ sung không tồn tại hoặc không active: ${missingProducts.join(", ")}.`);
  }
  const withoutVariants = validated.products
    .map((product) => clean(product.key))
    .filter((key) => !productByKey.get(key)?.has_active_variant);
  if (withoutVariants.length) {
    throw new Error(`Mã bổ sung không có size/cup active: ${withoutVariants.join(", ")}.`);
  }

  const productIds = validated.products.map((product) => productByKey.get(clean(product.key)).id);
  const existingResult = await client.query(
    `
      SELECT product_id::text, code, name, sort_order, is_active
      FROM japan_underwear.product_colors
      WHERE product_id = ANY($1::uuid[])
      ORDER BY product_id, sort_order, code
    `,
    [productIds],
  );

  const expectedCodesById = new Map();
  const colorRows = [];
  for (const product of validated.products) {
    const productId = productByKey.get(clean(product.key)).id;
    const codes = new Set();
    for (const color of product.colors) {
      const code = clean(color.code).toLowerCase();
      codes.add(code);
      colorRows.push({
        product_id: productId,
        code,
        name: clean(color.name),
        sort_order: Number(color.sortOrder),
      });
    }
    expectedCodesById.set(productId, codes);
  }

  const unexpectedActiveColors = existingResult.rows.filter(
    (row) =>
      row.is_active &&
      !expectedCodesById.get(String(row.product_id))?.has(clean(row.code).toLowerCase()),
  );
  if (unexpectedActiveColors.length) {
    throw new Error(
      `Bốn mã đang có màu active ngoài xác nhận: ${unexpectedActiveColors
        .map((row) => `${row.product_id}:${row.code}`)
        .join(", ")}. Dừng để review, không tự xóa.`,
    );
  }

  console.log(`Matched active products: ${productIds.length}`);
  console.log(`Colors planned: ${colorRows.length}`);
  console.log(`Unexpected active colors: ${unexpectedActiveColors.length}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  if (!apply) {
    console.log("DRY RUN: chưa ghi PostgreSQL.");
    process.exit(0);
  }

  const variantBefore = await readVariantSnapshot();
  const variantHashBefore = sha256(JSON.stringify(variantBefore));

  const runResult = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "catalog-owner-color-supplement",
      validated.manifestHash,
      JSON.stringify({
        confirmedBy: validated.confirmedBy,
        confirmedAt: validated.confirmedAt,
        confirmationHash: validated.confirmationHash,
        plannedProducts: validated.products.length,
        plannedColors: colorRows.length,
        variantSnapshotSha256: variantHashBefore,
      }),
    ],
  );
  runId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:owner-color-supplement'))",
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
    ["catalog-owner-color-supplement"],
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
    [crypto.randomUUID()],
  );

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
    [JSON.stringify(colorRows)],
  );

  const afterColors = await client.query(
    `
      SELECT product_id::text, code, name, sort_order
      FROM japan_underwear.product_colors
      WHERE product_id = ANY($1::uuid[])
        AND is_active = true
      ORDER BY product_id, sort_order, code
    `,
    [productIds],
  );
  const actualById = new Map();
  for (const row of afterColors.rows) {
    const current = actualById.get(String(row.product_id)) ?? [];
    current.push({
      code: clean(row.code).toLowerCase(),
      name: clean(row.name),
      sort_order: Number(row.sort_order),
    });
    actualById.set(String(row.product_id), current);
  }
  for (const product of validated.products) {
    const productId = productByKey.get(clean(product.key)).id;
    const expected = product.colors.map((color) => ({
      code: clean(color.code).toLowerCase(),
      name: clean(color.name),
      sort_order: Number(color.sortOrder),
    }));
    const actual = actualById.get(productId) ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Hậu kiểm bộ màu thất bại: ${product.key} ${actual.length}/${expected.length}.`);
    }
  }

  const variantAfter = await readVariantSnapshot();
  const variantHashAfter = sha256(JSON.stringify(variantAfter));
  if (
    JSON.stringify(variantAfter) !== JSON.stringify(variantBefore) ||
    variantHashAfter !== variantHashBefore
  ) {
    throw new Error("product_variants thay đổi trong lúc nhập màu; transaction đã bị hủy.");
  }

  const orderableResult = await client.query(
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
  if (Number(orderableResult.rows[0].count) !== 4) {
    throw new Error(`Hậu kiểm đặt hàng thất bại: ${orderableResult.rows[0].count}/4.`);
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
        confirmedBy: validated.confirmedBy,
        confirmedAt: validated.confirmedAt,
        confirmationHash: validated.confirmationHash,
        importedProducts: 4,
        importedColors: 12,
        orderableProducts: 4,
        variantSnapshotSha256Before: variantHashBefore,
        variantSnapshotSha256After: variantHashAfter,
      }),
    ],
  );

  console.log("Owner color supplement import OK.");
  console.log("Products: 4. Colors: 12. Orderable products: 4.");
  console.log("Descriptions, prices and product_variants were not updated.");
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
