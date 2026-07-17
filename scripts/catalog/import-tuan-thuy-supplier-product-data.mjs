import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const validateOnly = args.includes("--validate-only");
const positional = args.filter((arg) => !arg.startsWith("--"));

for (const arg of args) {
  if (!["--apply", "--validate-only"].includes(arg) && !positional.includes(arg)) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (apply && validateOnly) {
  throw new Error("Không được dùng đồng thời --apply và --validate-only.");
}
if (positional.length !== 2) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-supplier-product-data.mjs <supplier-manifest.json> <source.xlsx> [--validate-only|--apply]",
  );
}

const [manifestArgument, sourceArgument] = positional;
const manifestPath = path.resolve(cwd, manifestArgument);
const sourcePath = path.resolve(cwd, sourceArgument);
const [manifestRaw, sourceBuffer] = await Promise.all([
  fs.readFile(manifestPath, "utf8"),
  fs.readFile(sourcePath),
]);
const manifest = JSON.parse(manifestRaw);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) {
    throw new Error(`Product key không hợp lệ: ${key}`);
  }
  return { brand, category, modelCode };
}

function validateManifest() {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Supplier manifest schemaVersion phải là 1; nhận ${manifest.schemaVersion}.`);
  }

  const source = manifest.sourceSupplierFile;
  if (!source?.filename || !/^[a-f0-9]{64}$/i.test(clean(source.sha256))) {
    throw new Error("Supplier manifest thiếu filename hoặc SHA-256 của file Excel nguồn.");
  }
  const actualSourceHash = sha256(sourceBuffer);
  if (actualSourceHash !== clean(source.sha256).toLowerCase()) {
    throw new Error(
      `File Excel nguồn không khớp manifest: ${actualSourceHash}/${source.sha256}.`,
    );
  }

  const rules = manifest.businessRules ?? {};
  if (
    !rules.supplierSpreadsheetIsExplicitColorList ||
    !rules.colorSetCompletenessVerifiedPerListedProduct ||
    !rules.descriptionsAreCondensedFromSupplierHighlights ||
    !rules.noVariantWrite ||
    !rules.noPriceWrite
  ) {
    throw new Error("Supplier manifest thiếu các quy tắc bảo toàn dữ liệu bắt buộc.");
  }

  const products = manifest.products ?? [];
  const expectedCount = Number(manifest.summary?.inScopeBraProductCount);
  if (!Number.isInteger(expectedCount) || products.length !== expectedCount || expectedCount <= 0) {
    throw new Error(
      `Số product trong manifest lệch summary: ${products.length}/${expectedCount}.`,
    );
  }

  const seenProductKeys = new Set();
  let colorCount = 0;
  for (const product of products) {
    const key = clean(product.key);
    const identity = parseKey(key);
    if (seenProductKeys.has(key)) throw new Error(`Product trùng: ${key}`);
    seenProductKeys.add(key);

    if (identity.category !== "ao-nguc") {
      throw new Error(`Supplier importer chỉ nhận áo ngực; gặp ${key}.`);
    }
    if (!["pensee", "winking"].includes(identity.brand)) {
      throw new Error(`Brand không hợp lệ: ${key}.`);
    }
    if (!/^\d{4}$/.test(identity.modelCode)) {
      throw new Error(`Model code không hợp lệ: ${key}.`);
    }
    if (clean(product.brand) !== identity.brand || clean(product.category) !== identity.category) {
      throw new Error(`Identity trong object không khớp key: ${key}.`);
    }
    if (clean(product.modelCode) !== identity.modelCode) {
      throw new Error(`modelCode không khớp key: ${key}.`);
    }
    if (product.colorSetComplete !== true) {
      throw new Error(`Product ${key} chưa xác nhận bộ màu đầy đủ.`);
    }
    if (!(product.completenessEvidenceTypes ?? []).includes("supplier-confirmed-color-list")) {
      throw new Error(`Product ${key} thiếu bằng chứng danh sách màu từ nhà cung cấp.`);
    }
    if (!(product.completenessEvidenceTexts ?? []).length || !(product.sourceRows ?? []).length) {
      throw new Error(`Product ${key} thiếu nội dung hoặc dòng nguồn.`);
    }
    if ((product.colorConflicts ?? []).length) {
      throw new Error(`Product ${key} còn xung đột màu trong file nguồn.`);
    }

    const description = clean(product.shortDescription);
    if (description.length < 20 || description.length > 300) {
      throw new Error(`Mô tả rút gọn ${key} phải dài 20-300 ký tự; nhận ${description.length}.`);
    }

    const colors = product.colors ?? [];
    if (colors.length === 0) throw new Error(`Product ${key} không có màu.`);
    const seenCodes = new Set();
    for (const color of colors) {
      const code = clean(color.code).toLowerCase();
      const name = clean(color.name);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || !name) {
        throw new Error(`Màu không hợp lệ: ${key} ${code}/${name}.`);
      }
      if (seenCodes.has(code)) throw new Error(`Màu trùng: ${key}:${code}.`);
      seenCodes.add(code);
      if (color.consensusStatus !== "consensus") {
        throw new Error(`Màu ${key}:${code} chưa có đồng thuận Tên/Màu/SKU.`);
      }
      const evidence = color.evidenceColumns ?? {};
      if (!clean(evidence.productName) || !clean(evidence.color) || !clean(evidence.sku)) {
        throw new Error(`Màu ${key}:${code} thiếu ba cột bằng chứng.`);
      }
      colorCount += 1;
    }
  }

  if (colorCount !== Number(manifest.summary?.inScopeColorCount)) {
    throw new Error(
      `Tổng màu lệch summary: ${colorCount}/${manifest.summary?.inScopeColorCount}.`,
    );
  }

  const targetCoverage = manifest.targetCoverage ?? [];
  if (
    Number(manifest.summary?.targetMissingColorProductCount) !== 30 ||
    targetCoverage.length !== 30
  ) {
    throw new Error("Supplier manifest phải đối chiếu đúng baseline 30 mã thiếu màu.");
  }
  const covered = targetCoverage.filter((item) => item.present === true).length;
  const missing = targetCoverage.filter((item) => item.present !== true).length;
  if (
    covered !== Number(manifest.summary?.targetProductsCovered) ||
    missing !== Number(manifest.summary?.targetProductsStillMissing)
  ) {
    throw new Error(`Target coverage lệch summary: ${covered}/${missing}.`);
  }

  return {
    products,
    colorCount,
    sourceHash: actualSourceHash,
    targetCovered: covered,
    targetMissing: missing,
  };
}

const validated = validateManifest();

console.log("=== Tuấn Thủy supplier product data ===");
console.log(`Manifest: ${manifestPath}`);
console.log(`Source Excel: ${sourcePath}`);
console.log(`Source SHA-256: ${validated.sourceHash}`);
console.log(`Supplier bras: ${validated.products.length}`);
console.log(`Supplier colors: ${validated.colorCount}`);
console.log(
  `Baseline 30 thiếu màu: có nguồn ${validated.targetCovered}; còn thiếu ${validated.targetMissing}.`,
);

if (validateOnly) {
  console.log("VALIDATE ONLY: manifest và file Excel khớp; chưa kết nối PostgreSQL.");
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

async function readVariantSnapshot() {
  const result = await client.query(`
    SELECT
      variant.id::text,
      variant.product_id::text,
      variant.size_code,
      COALESCE(variant.cup_code, '') AS cup_code,
      COALESCE(variant.sku, '') AS sku,
      COALESCE(variant.price_override::text, '') AS price_override,
      variant.is_active
    FROM japan_underwear.product_variants AS variant
    ORDER BY variant.product_id, variant.size_code, variant.cup_code, variant.id
  `);
  return result.rows;
}

try {
  await client.connect();

  const schemaResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.product_colors') AS colors_table,
      to_regclass('japan_underwear.product_variants') AS variants_table,
      to_regclass('japan_underwear.catalog_import_runs') AS runs_table,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'products'
          AND column_name = 'short_description'
      ) AS has_short_description,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'products'
          AND column_name = 'row_version'
      ) AS has_product_row_version,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'japan_underwear'
          AND table_name = 'product_colors'
          AND column_name = 'row_version'
      ) AS has_color_row_version
  `);
  const schema = schemaResult.rows[0];
  if (
    !schema.products_table ||
    !schema.colors_table ||
    !schema.variants_table ||
    !schema.runs_table ||
    !schema.has_short_description ||
    !schema.has_product_row_version ||
    !schema.has_color_row_version
  ) {
    throw new Error("Schema catalog chưa sẵn sàng. Chạy npm run db:migrate và npm run db:verify.");
  }

  const productResult = await client.query(`
    SELECT
      product.id::text,
      brand.slug AS brand,
      category.slug AS category,
      product.model_code,
      product.short_description,
      product.is_active
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true
      AND category.slug = 'ao-nguc'
    ORDER BY brand.slug, product.model_code
  `);
  const activeProducts = productResult.rows;
  const productByKey = new Map(
    activeProducts.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      row,
    ]),
  );
  const manifestByKey = new Map(validated.products.map((product) => [clean(product.key), product]));

  const matchedProducts = validated.products
    .map((product) => {
      const database = productByKey.get(clean(product.key));
      return database ? { manifest: product, database } : null;
    })
    .filter(Boolean);
  const supplierNotActive = validated.products
    .filter((product) => !productByKey.has(clean(product.key)))
    .map((product) => clean(product.key));
  const activeMissingSupplier = activeProducts
    .map((row) => `${row.brand}:${row.category}:${row.model_code}`)
    .filter((key) => !manifestByKey.has(key));

  const matchedIds = matchedProducts.map((item) => item.database.id);
  const existingColorResult = matchedIds.length
    ? await client.query(
        `
          SELECT
            color.product_id::text,
            color.code,
            color.name,
            color.sort_order,
            color.is_active
          FROM japan_underwear.product_colors AS color
          WHERE color.product_id = ANY($1::uuid[])
          ORDER BY color.product_id, color.sort_order, color.code
        `,
        [matchedIds],
      )
    : { rows: [] };

  const expectedCodesByProductId = new Map();
  const productRows = [];
  const colorRows = [];
  for (const item of matchedProducts) {
    const productId = item.database.id;
    const expectedCodes = new Set();
    productRows.push({
      product_id: productId,
      key: clean(item.manifest.key),
      short_description: clean(item.manifest.shortDescription),
    });
    item.manifest.colors.forEach((color, index) => {
      const code = clean(color.code).toLowerCase();
      expectedCodes.add(code);
      colorRows.push({
        product_id: productId,
        code,
        name: clean(color.name),
        sort_order: index,
      });
    });
    expectedCodesByProductId.set(productId, expectedCodes);
  }

  const unexpectedActiveColors = existingColorResult.rows.filter(
    (row) =>
      row.is_active &&
      !expectedCodesByProductId.get(String(row.product_id))?.has(clean(row.code).toLowerCase()),
  );
  const descriptionsToUpdate = matchedProducts.filter(
    (item) =>
      clean(item.database.short_description) !== clean(item.manifest.shortDescription),
  );

  console.log(`Active bras in PostgreSQL: ${activeProducts.length}`);
  console.log(`Matched supplier products: ${matchedProducts.length}`);
  console.log(`Supplier products not active in app: ${supplierNotActive.length}`);
  console.log(`Active app bras missing supplier rows: ${activeMissingSupplier.length}`);
  console.log(`Colors planned: ${colorRows.length}`);
  console.log(`Descriptions planned: ${descriptionsToUpdate.length}`);
  console.log(`Unexpected active colors: ${unexpectedActiveColors.length}`);
  if (supplierNotActive.length) {
    console.log(`Supplier-only: ${supplierNotActive.join(", ")}`);
  }
  if (activeMissingSupplier.length) {
    console.log(`App-only/missing supplier: ${activeMissingSupplier.join(", ")}`);
  }
  if (unexpectedActiveColors.length) {
    console.log(
      `Color conflicts: ${unexpectedActiveColors
        .map((row) => `${row.product_id}:${row.code}`)
        .join(", ")}`,
    );
    throw new Error(
      "PostgreSQL đang có màu active ngoài danh sách đầy đủ của nhà cung cấp. Dừng để review, không tự xóa.",
    );
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  if (!apply) {
    console.log("DRY RUN: chưa ghi PostgreSQL.");
    process.exit(0);
  }

  if (matchedProducts.length === 0) {
    throw new Error("Không có product supplier nào khớp catalog active.");
  }

  const variantSnapshotBefore = await readVariantSnapshot();
  const variantSnapshotHashBefore = sha256(JSON.stringify(variantSnapshotBefore));
  const manifestHash = sha256(manifestRaw);

  const runResult = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "tuan-thuy-supplier-product-data",
      manifestHash,
      JSON.stringify({
        sourceFile: manifest.sourceSupplierFile.filename,
        sourceSha256: validated.sourceHash,
        supplierProducts: validated.products.length,
        matchedProducts: matchedProducts.length,
        plannedColors: colorRows.length,
        plannedDescriptions: descriptionsToUpdate.length,
        supplierNotActive,
        activeMissingSupplier,
        variantSnapshotSha256: variantSnapshotHashBefore,
      }),
    ],
  );
  runId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:supplier-product-import'))",
  );

  const requestId = crypto.randomUUID();
  await client.query(
    "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
    ["supplier-product-import"],
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
    [requestId],
  );

  await client.query(
    `
      UPDATE japan_underwear.products AS product
      SET short_description = input.short_description
      FROM jsonb_to_recordset($1::jsonb)
        AS input(product_id uuid, short_description text)
      WHERE product.id = input.product_id
        AND product.short_description IS DISTINCT FROM input.short_description
    `,
    [JSON.stringify(productRows)],
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

  const [afterProductsResult, afterColorsResult] = await Promise.all([
    client.query(
      `
        SELECT id::text, short_description
        FROM japan_underwear.products
        WHERE id = ANY($1::uuid[])
      `,
      [matchedIds],
    ),
    client.query(
      `
        SELECT product_id::text, code, name, sort_order
        FROM japan_underwear.product_colors
        WHERE product_id = ANY($1::uuid[])
          AND is_active = true
        ORDER BY product_id, sort_order, code
      `,
      [matchedIds],
    ),
  ]);

  const descriptionById = new Map(
    afterProductsResult.rows.map((row) => [String(row.id), clean(row.short_description)]),
  );
  for (const row of productRows) {
    if (descriptionById.get(row.product_id) !== row.short_description) {
      throw new Error(`Hậu kiểm mô tả thất bại: ${row.key}.`);
    }
  }

  const actualColorsByProductId = new Map();
  for (const row of afterColorsResult.rows) {
    const current = actualColorsByProductId.get(String(row.product_id)) ?? [];
    current.push({
      code: clean(row.code).toLowerCase(),
      name: clean(row.name),
      sort_order: Number(row.sort_order),
    });
    actualColorsByProductId.set(String(row.product_id), current);
  }
  for (const item of matchedProducts) {
    const expected = item.manifest.colors.map((color, index) => ({
      code: clean(color.code).toLowerCase(),
      name: clean(color.name),
      sort_order: index,
    }));
    const actual = actualColorsByProductId.get(item.database.id) ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Hậu kiểm bộ màu đầy đủ thất bại: ${item.manifest.key} ${actual.length}/${expected.length}.`,
      );
    }
  }

  const variantSnapshotAfter = await readVariantSnapshot();
  const variantSnapshotHashAfter = sha256(JSON.stringify(variantSnapshotAfter));
  if (
    JSON.stringify(variantSnapshotAfter) !== JSON.stringify(variantSnapshotBefore) ||
    variantSnapshotHashAfter !== variantSnapshotHashBefore
  ) {
    throw new Error("product_variants thay đổi trong lúc nhập supplier data; transaction đã bị hủy.");
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
        sourceFile: manifest.sourceSupplierFile.filename,
        sourceSha256: validated.sourceHash,
        matchedProducts: matchedProducts.length,
        importedColors: colorRows.length,
        updatedDescriptions: descriptionsToUpdate.length,
        supplierNotActive,
        activeMissingSupplier,
        targetProductsCovered: validated.targetCovered,
        targetProductsStillMissing: validated.targetMissing,
        variantSnapshotSha256Before: variantSnapshotHashBefore,
        variantSnapshotSha256After: variantSnapshotHashAfter,
      }),
    ],
  );

  console.log("Supplier product import OK.");
  console.log(`Products matched: ${matchedProducts.length}.`);
  console.log(`Colors active: ${colorRows.length}.`);
  console.log(`Descriptions synchronized: ${productRows.length}.`);
  console.log("Prices and product_variants were not updated.");
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
  if (runId) {
    await client
      .query(
        `
          UPDATE japan_underwear.catalog_import_runs
          SET status = 'failed',
              error_message = $2,
              finished_at = now()
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
