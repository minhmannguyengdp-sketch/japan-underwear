import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
const apply = args.includes("--apply");
const validateOnly = args.includes("--validate-only");
for (const arg of args) {
  if (arg !== inputArgument && arg !== "--apply" && arg !== "--validate-only") {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (apply && validateOnly) {
  throw new Error("Không được dùng đồng thời --apply và --validate-only.");
}
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-supplier-color-reconciliation.mjs <approved-reconciliation.json> [--validate-only|--apply]",
  );
}

const inputPath = path.resolve(cwd, inputArgument);
const approvedRaw = await fs.readFile(inputPath, "utf8");
const approved = JSON.parse(approvedRaw);

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

async function readLockedSource(source, label) {
  if (!source?.path || !/^[a-f0-9]{64}$/i.test(clean(source.sha256))) {
    throw new Error(`${label} thiếu path hoặc SHA-256.`);
  }
  const raw = await fs.readFile(path.resolve(cwd, source.path), "utf8");
  if (sha256(raw) !== clean(source.sha256).toLowerCase()) {
    throw new Error(`${label} đã thay đổi sau khi owner duyệt reconciliation.`);
  }
  return { raw, json: JSON.parse(raw) };
}

if (approved.schemaVersion !== 1) throw new Error("Approved reconciliation schemaVersion phải là 1.");
if (
  approved.approval?.status !== "approved" ||
  approved.approval?.ownerApproved !== true ||
  !/^[a-f0-9]{64}$/i.test(clean(approved.approval?.reviewSha256))
) {
  throw new Error("Reconciliation chưa được chủ catalog duyệt hợp lệ.");
}

const rules = approved.businessRules ?? {};
if (
  !rules.supplierListIsCompleteForMatchedProducts ||
  !rules.deactivateOnlyUnexpectedActiveColors ||
  !rules.neverDeleteColorRows ||
  !rules.noProductCreation ||
  !rules.noDescriptionWrite ||
  !rules.noPriceWrite ||
  !rules.noVariantWrite
) {
  throw new Error("Approved reconciliation thiếu quy tắc bảo toàn dữ liệu bắt buộc.");
}

const [supplierSource, auditSource] = await Promise.all([
  readLockedSource(approved.sourceSupplierManifest, "Supplier manifest"),
  readLockedSource(approved.sourceConflictAudit, "Conflict audit"),
]);
const supplier = supplierSource.json;
const audit = auditSource.json;
if (supplier.schemaVersion !== 1 || !Array.isArray(supplier.products)) {
  throw new Error("Supplier manifest khóa trong reconciliation không hợp lệ.");
}
if (audit.schemaVersion !== 1 || !Array.isArray(audit.conflicts)) {
  throw new Error("Conflict audit khóa trong reconciliation không hợp lệ.");
}

const supplierCodesByKey = new Map();
for (const product of supplier.products) {
  const key = clean(product.key);
  parseKey(key);
  const codes = (product.colors ?? []).map((color) => clean(color.code).toLowerCase());
  if (codes.length === 0 || new Set(codes).size !== codes.length) {
    throw new Error(`Supplier color set không hợp lệ: ${key}.`);
  }
  supplierCodesByKey.set(key, new Set(codes));
}

const products = approved.products ?? [];
const approvedProductCount = Number(approved.approval?.approvedProductCount);
const approvedColorCount = Number(approved.approval?.approvedColorCount);
if (
  products.length !== approvedProductCount ||
  products.length !== Number(approved.summary?.productCount) ||
  products.length <= 0
) {
  throw new Error("Approved reconciliation lệch số product.");
}

const approvedUnexpectedKeys = [];
const approvedNamesByUnexpectedKey = new Map();
const seenProductKeys = new Set();
for (const product of products) {
  const key = clean(product.key);
  const identity = parseKey(key);
  if (seenProductKeys.has(key)) throw new Error(`Reconciliation product trùng: ${key}.`);
  seenProductKeys.add(key);
  if (
    clean(product.brand) !== identity.brand ||
    clean(product.category) !== identity.category ||
    clean(product.modelCode) !== identity.modelCode
  ) {
    throw new Error(`Identity reconciliation không khớp key: ${key}.`);
  }

  const supplierCodes = supplierCodesByKey.get(key);
  if (!supplierCodes) throw new Error(`Reconciliation product không còn trong supplier manifest: ${key}.`);
  const expectedCodes = (product.supplierCompleteColors ?? []).map((color) =>
    clean(color.code).toLowerCase(),
  );
  if (
    JSON.stringify([...supplierCodes]) !== JSON.stringify(expectedCodes) ||
    new Set(expectedCodes).size !== expectedCodes.length
  ) {
    throw new Error(`Supplier complete colors lệch manifest: ${key}.`);
  }

  const colorsToDeactivate = product.colorsToDeactivate ?? [];
  if (colorsToDeactivate.length === 0) {
    throw new Error(`Reconciliation ${key} không có màu cần chuyển inactive.`);
  }
  const seenCodes = new Set();
  for (const color of colorsToDeactivate) {
    const code = clean(color.code).toLowerCase();
    const name = clean(color.name);
    if (!code || !name || seenCodes.has(code) || supplierCodes.has(code)) {
      throw new Error(`Màu reconciliation không hợp lệ: ${key}:${code}.`);
    }
    seenCodes.add(code);
    const unexpectedKey = `${key}:${code}`;
    approvedUnexpectedKeys.push(unexpectedKey);
    approvedNamesByUnexpectedKey.set(unexpectedKey, name);
  }
}
approvedUnexpectedKeys.sort();
if (
  approvedUnexpectedKeys.length !== approvedColorCount ||
  approvedUnexpectedKeys.length !== Number(approved.summary?.colorCount) ||
  approvedUnexpectedKeys.length !== Number(audit.summary?.unexpectedActiveColorCount)
) {
  throw new Error("Approved reconciliation lệch số màu cần chuyển inactive.");
}

console.log("=== Supplier color reconciliation import ===");
console.log(`Approved file: ${inputPath}`);
console.log(`Products: ${products.length}`);
console.log(`Colors to deactivate: ${approvedUnexpectedKeys.length}`);
console.log("Operation: set is_active=false; never delete rows.");
console.log("Products, descriptions, prices and product_variants: không cập nhật.");

if (validateOnly) {
  console.log("VALIDATE ONLY: reconciliation và source hashes hợp lệ; chưa kết nối PostgreSQL.");
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

let runId;
let transactionStarted = false;
try {
  await client.connect();

  const schemaResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.product_colors') AS colors_table,
      to_regclass('japan_underwear.product_variants') AS variants_table,
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
    !schema.colors_table ||
    !schema.variants_table ||
    !schema.runs_table ||
    !schema.has_color_row_version
  ) {
    throw new Error("Schema catalog chưa sẵn sàng. Chạy npm run db:migrate và npm run db:verify.");
  }

  const productResult = await client.query(`
    SELECT product.id::text, brand.slug AS brand, category.slug AS category, product.model_code
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true
      AND category.slug = 'ao-nguc'
  `);
  const productByKey = new Map(
    productResult.rows.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      String(row.id),
    ]),
  );

  const matchedSupplierKeys = [...supplierCodesByKey.keys()].filter((key) => productByKey.has(key));
  const matchedSupplierIds = matchedSupplierKeys.map((key) => productByKey.get(key));
  const keyByProductId = new Map(
    matchedSupplierKeys.map((key) => [productByKey.get(key), key]),
  );
  const missingReconciliationProducts = products
    .map((product) => clean(product.key))
    .filter((key) => !productByKey.has(key));
  if (missingReconciliationProducts.length) {
    throw new Error(
      `Reconciliation product không tồn tại hoặc không active: ${missingReconciliationProducts.join(", ")}`,
    );
  }

  const activeColorResult = matchedSupplierIds.length
    ? await client.query(
        `
          SELECT product_id::text, code, name, is_active
          FROM japan_underwear.product_colors
          WHERE product_id = ANY($1::uuid[])
            AND is_active = true
          ORDER BY product_id, code
        `,
        [matchedSupplierIds],
      )
    : { rows: [] };

  const actualUnexpectedKeys = [];
  const activeColorByUnexpectedKey = new Map();
  for (const row of activeColorResult.rows) {
    const key = keyByProductId.get(String(row.product_id));
    const code = clean(row.code).toLowerCase();
    if (!supplierCodesByKey.get(key)?.has(code)) {
      const unexpectedKey = `${key}:${code}`;
      actualUnexpectedKeys.push(unexpectedKey);
      activeColorByUnexpectedKey.set(unexpectedKey, {
        productId: String(row.product_id),
        code,
        name: clean(row.name),
      });
    }
  }
  actualUnexpectedKeys.sort();

  if (JSON.stringify(actualUnexpectedKeys) !== JSON.stringify(approvedUnexpectedKeys)) {
    const approvedSet = new Set(approvedUnexpectedKeys);
    const actualSet = new Set(actualUnexpectedKeys);
    const newUnexpected = actualUnexpectedKeys.filter((key) => !approvedSet.has(key));
    const noLongerActive = approvedUnexpectedKeys.filter((key) => !actualSet.has(key));
    throw new Error(
      [
        "PostgreSQL không còn khớp reconciliation đã duyệt.",
        newUnexpected.length ? `Phát sinh ngoài manifest: ${newUnexpected.join(", ")}.` : "",
        noLongerActive.length ? `Không còn active: ${noLongerActive.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  for (const unexpectedKey of approvedUnexpectedKeys) {
    const actual = activeColorByUnexpectedKey.get(unexpectedKey);
    console.log(
      `${unexpectedKey}: ${actual?.name ?? approvedNamesByUnexpectedKey.get(unexpectedKey)} -> inactive`,
    );
  }
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  if (!apply) {
    console.log("DRY RUN: chưa ghi PostgreSQL.");
    process.exit(0);
  }

  const variantSnapshotBefore = await readVariantSnapshot();
  const variantHashBefore = sha256(JSON.stringify(variantSnapshotBefore));
  const rowsToDeactivate = approvedUnexpectedKeys.map((unexpectedKey) => {
    const row = activeColorByUnexpectedKey.get(unexpectedKey);
    return { product_id: row.productId, code: row.code };
  });

  const runResult = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "tuan-thuy-supplier-color-reconciliation",
      sha256(approvedRaw),
      JSON.stringify({
        plannedProducts: products.length,
        plannedDeactivatedColors: rowsToDeactivate.length,
        supplierManifestSha256: approved.sourceSupplierManifest.sha256,
        conflictAuditSha256: approved.sourceConflictAudit.sha256,
        variantSnapshotSha256: variantHashBefore,
      }),
    ],
  );
  runId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:supplier-color-reconciliation'))",
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
    ["supplier-color-reconciliation"],
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
    [crypto.randomUUID()],
  );

  const updateResult = await client.query(
    `
      UPDATE japan_underwear.product_colors AS color
      SET is_active = false
      FROM jsonb_to_recordset($1::jsonb) AS input(product_id uuid, code text)
      WHERE color.product_id = input.product_id
        AND color.code = input.code
        AND color.is_active = true
      RETURNING color.product_id::text, color.code
    `,
    [JSON.stringify(rowsToDeactivate)],
  );
  if (updateResult.rowCount !== rowsToDeactivate.length) {
    throw new Error(
      `Số màu chuyển inactive lệch: ${updateResult.rowCount}/${rowsToDeactivate.length}.`,
    );
  }

  const remainingUnexpectedResult = await client.query(
    `
      SELECT product_id::text, code
      FROM japan_underwear.product_colors
      WHERE product_id = ANY($1::uuid[])
        AND is_active = true
    `,
    [matchedSupplierIds],
  );
  const remainingUnexpected = remainingUnexpectedResult.rows
    .map((row) => {
      const key = keyByProductId.get(String(row.product_id));
      const code = clean(row.code).toLowerCase();
      return supplierCodesByKey.get(key)?.has(code) ? null : `${key}:${code}`;
    })
    .filter(Boolean)
    .sort();
  if (remainingUnexpected.length) {
    throw new Error(`Hậu kiểm còn màu active ngoài supplier: ${remainingUnexpected.join(", ")}.`);
  }

  const variantSnapshotAfter = await readVariantSnapshot();
  const variantHashAfter = sha256(JSON.stringify(variantSnapshotAfter));
  if (
    JSON.stringify(variantSnapshotAfter) !== JSON.stringify(variantSnapshotBefore) ||
    variantHashAfter !== variantHashBefore
  ) {
    throw new Error("product_variants thay đổi trong lúc reconcile màu; transaction đã bị hủy.");
  }

  await client.query("COMMIT");
  transactionStarted = false;

  await client.query(
    `
      UPDATE japan_underwear.catalog_import_runs
      SET status = 'completed', summary = $2::jsonb, finished_at = now(), error_message = NULL
      WHERE id = $1
    `,
    [
      runId,
      JSON.stringify({
        reconciledProducts: products.length,
        deactivatedColors: rowsToDeactivate.length,
        remainingUnexpectedActiveColors: 0,
        supplierManifestSha256: approved.sourceSupplierManifest.sha256,
        conflictAuditSha256: approved.sourceConflictAudit.sha256,
        variantSnapshotSha256Before: variantHashBefore,
        variantSnapshotSha256After: variantHashAfter,
      }),
    ],
  );

  console.log("Supplier color reconciliation OK.");
  console.log(`Colors marked inactive: ${rowsToDeactivate.length}.`);
  console.log("No rows deleted; product_variants, prices and descriptions unchanged.");
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
