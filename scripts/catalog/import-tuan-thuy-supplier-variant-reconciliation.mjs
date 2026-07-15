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
    "Usage: node scripts/catalog/import-tuan-thuy-supplier-variant-reconciliation.mjs <approved-reconciliation.json> [--validate-only|--apply]",
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

function normalizeVariant(variant) {
  const sizeCode = clean(variant?.sizeCode);
  const cupCode = clean(variant?.cupCode).toUpperCase();
  if (!/^\d{2,3}$/.test(sizeCode) || !/^[A-Z]+$/.test(cupCode)) {
    throw new Error(`Variant không hợp lệ: ${sizeCode}${cupCode}.`);
  }
  return { sizeCode, cupCode };
}

function identityKey(productKey, variant) {
  return `${productKey}:${variant.sizeCode}:${variant.cupCode}`;
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

if (approved.schemaVersion !== 1) {
  throw new Error("Approved variant reconciliation schemaVersion phải là 1.");
}
if (
  approved.approval?.status !== "approved" ||
  approved.approval?.ownerApproved !== true ||
  !/^[a-f0-9]{64}$/i.test(clean(approved.approval?.reviewSha256))
) {
  throw new Error("Variant reconciliation chưa được chủ catalog duyệt hợp lệ.");
}

const rules = approved.businessRules ?? {};
for (const rule of [
  "supplierVariantUnionIsCompleteForMatchedProducts",
  "deactivateOnlyUnexpectedActiveVariants",
  "neverDeleteVariantRows",
  "noProductCreation",
  "noColorWrite",
  "noDescriptionWrite",
  "noPriceWrite",
  "noOrderWrite",
  "historicalOrderSnapshotsUnchanged",
  "noAvailabilityWrite",
]) {
  if (rules[rule] !== true) {
    throw new Error(`Approved reconciliation thiếu quy tắc bảo toàn: ${rule}.`);
  }
}

const [supplierSource, auditSource] = await Promise.all([
  readLockedSource(approved.sourceSupplierManifest, "Supplier manifest"),
  readLockedSource(approved.sourceConflictAudit, "Variant conflict audit"),
]);
const supplier = supplierSource.json;
const audit = auditSource.json;
if (supplier.schemaVersion !== 1 || !Array.isArray(supplier.products)) {
  throw new Error("Supplier manifest khóa trong reconciliation không hợp lệ.");
}
if (audit.schemaVersion !== 1 || !Array.isArray(audit.conflicts)) {
  throw new Error("Variant conflict audit khóa trong reconciliation không hợp lệ.");
}

const supplierVariantsByKey = new Map();
for (const product of supplier.products) {
  const key = clean(product.key);
  parseKey(key);
  const variants = (product.uniqueVariants ?? []).map(normalizeVariant);
  const keys = variants.map((variant) => `${variant.sizeCode}:${variant.cupCode}`);
  if (variants.length === 0 || new Set(keys).size !== variants.length) {
    throw new Error(`Supplier variant set không hợp lệ: ${key}.`);
  }
  supplierVariantsByKey.set(key, variants);
}

const products = approved.products ?? [];
const approvedProductCount = Number(approved.approval?.approvedProductCount);
const approvedVariantCount = Number(approved.approval?.approvedVariantCount);
if (
  products.length !== approvedProductCount ||
  products.length !== Number(approved.summary?.productCount) ||
  products.length <= 0
) {
  throw new Error("Approved reconciliation lệch số product.");
}

const approvedUnexpected = [];
const approvedByIdentity = new Map();
const seenProductKeys = new Set();
for (const product of products) {
  const key = clean(product.key);
  const parsed = parseKey(key);
  if (seenProductKeys.has(key)) throw new Error(`Reconciliation product trùng: ${key}.`);
  seenProductKeys.add(key);
  if (
    clean(product.brand) !== parsed.brand ||
    clean(product.category) !== parsed.category ||
    clean(product.modelCode) !== parsed.modelCode
  ) {
    throw new Error(`Identity reconciliation không khớp key: ${key}.`);
  }

  const supplierVariants = supplierVariantsByKey.get(key);
  if (!supplierVariants) {
    throw new Error(`Reconciliation product không còn trong supplier manifest: ${key}.`);
  }
  const expectedComplete = (product.supplierCompleteVariants ?? []).map(normalizeVariant);
  if (JSON.stringify(expectedComplete) !== JSON.stringify(supplierVariants)) {
    throw new Error(`Supplier complete variants lệch manifest: ${key}.`);
  }
  const expectedSet = new Set(
    supplierVariants.map((variant) => `${variant.sizeCode}:${variant.cupCode}`),
  );

  const variantsToDeactivate = product.variantsToDeactivate ?? [];
  if (variantsToDeactivate.length === 0) {
    throw new Error(`Reconciliation ${key} không có variant cần chuyển inactive.`);
  }
  const seenVariants = new Set();
  for (const rawVariant of variantsToDeactivate) {
    const variant = normalizeVariant(rawVariant);
    const id = clean(rawVariant.id);
    const localIdentity = `${variant.sizeCode}:${variant.cupCode}`;
    if (
      !/^[a-f0-9-]{36}$/i.test(id) ||
      seenVariants.has(localIdentity) ||
      expectedSet.has(localIdentity)
    ) {
      throw new Error(`Variant reconciliation không hợp lệ: ${key}:${localIdentity}.`);
    }
    seenVariants.add(localIdentity);
    const fullIdentity = identityKey(key, variant);
    approvedUnexpected.push(fullIdentity);
    approvedByIdentity.set(fullIdentity, { id, key, ...variant });
  }
}
approvedUnexpected.sort();
if (
  approvedUnexpected.length !== approvedVariantCount ||
  approvedUnexpected.length !== Number(approved.summary?.variantCount) ||
  approvedUnexpected.length !== Number(audit.summary?.unexpectedActiveVariantCount)
) {
  throw new Error("Approved reconciliation lệch số variant cần chuyển inactive.");
}

console.log("=== Supplier variant reconciliation import ===");
console.log(`Approved file: ${inputPath}`);
console.log(`Products: ${products.length}`);
console.log(`Variants to deactivate: ${approvedUnexpected.length}`);
console.log("Operation: set product_variants.is_active=false; never delete rows.");
console.log("Products, colors, descriptions, prices, orders and mappings: không cập nhật.");

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
  keepAlive: true,
});

async function readProtectedSnapshot() {
  const productsResult = await client.query(`
    SELECT id::text, base_price, currency, is_active, short_description
    FROM japan_underwear.products ORDER BY id
  `);
  const colorsResult = await client.query(`
    SELECT id::text, product_id::text, code, name, swatch, sort_order, is_active
    FROM japan_underwear.product_colors ORDER BY id
  `);
  const variantsResult = await client.query(`
    SELECT id::text, product_id::text, size_code, COALESCE(cup_code, '') AS cup_code,
           COALESCE(sku, '') AS sku, COALESCE(price_override::text, '') AS price_override
    FROM japan_underwear.product_variants
    ORDER BY id
  `);
  const availabilityResult = await client.query(`
    SELECT id::text, product_id::text, color_id::text, variant_id::text, source, is_active
    FROM japan_underwear.product_color_variants ORDER BY id
  `);
  const ordersResult = await client.query(`
    SELECT id::text, order_code, order_source, status, subtotal, currency, created_at
    FROM japan_underwear.orders ORDER BY id
  `);
  const orderItemsResult = await client.query(`
    SELECT id::text, order_id::text, product_variant_id::text, color_id::text,
           quantity, unit_price, line_total, product_code_snapshot,
           product_name_snapshot, color_code_snapshot, color_name_snapshot,
           size_code_snapshot, COALESCE(cup_code_snapshot, '') AS cup_code_snapshot
    FROM japan_underwear.order_items ORDER BY id
  `);
  return {
    products: productsResult.rows,
    colors: colorsResult.rows,
    variantIdentityAndPrices: variantsResult.rows,
    availability: availabilityResult.rows,
    orders: ordersResult.rows,
    orderItems: orderItemsResult.rows,
  };
}

let runId;
let transactionStarted = false;
try {
  await client.connect();
  const schemaResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.product_variants') AS variants_table,
      to_regclass('japan_underwear.product_color_variants') AS availability_table,
      to_regclass('japan_underwear.catalog_import_runs') AS runs_table
  `);
  const schema = schemaResult.rows[0];
  if (!schema.products_table || !schema.variants_table || !schema.availability_table || !schema.runs_table) {
    throw new Error("Schema variant reconciliation chưa sẵn sàng. Chạy npm run db:migrate.");
  }

  const productResult = await client.query(`
    SELECT product.id::text, brand.slug AS brand, category.slug AS category, product.model_code
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true AND category.slug = 'ao-nguc'
  `);
  const productByKey = new Map(
    productResult.rows.map((row) => [
      `${row.brand}:${row.category}:${row.model_code}`,
      String(row.id),
    ]),
  );
  const matchedSupplierKeys = [...supplierVariantsByKey.keys()].filter((key) => productByKey.has(key));
  const matchedSupplierIds = matchedSupplierKeys.map((key) => productByKey.get(key));
  const keyByProductId = new Map(
    matchedSupplierKeys.map((key) => [productByKey.get(key), key]),
  );

  const missingProducts = products
    .map((product) => clean(product.key))
    .filter((key) => !productByKey.has(key));
  if (missingProducts.length) {
    throw new Error(`Reconciliation product không tồn tại hoặc không active: ${missingProducts.join(", ")}`);
  }

  const activeVariantResult = matchedSupplierIds.length
    ? await client.query(
        `SELECT id::text, product_id::text, size_code, COALESCE(cup_code, '') AS cup_code
         FROM japan_underwear.product_variants
         WHERE product_id = ANY($1::uuid[]) AND is_active = true
         ORDER BY product_id, size_code, cup_code, id`,
        [matchedSupplierIds],
      )
    : { rows: [] };

  const actualUnexpected = [];
  const actualByIdentity = new Map();
  for (const row of activeVariantResult.rows) {
    const key = keyByProductId.get(String(row.product_id));
    const variant = normalizeVariant({ sizeCode: row.size_code, cupCode: row.cup_code });
    const supplierSet = new Set(
      (supplierVariantsByKey.get(key) ?? []).map(
        (item) => `${item.sizeCode}:${item.cupCode}`,
      ),
    );
    if (!supplierSet.has(`${variant.sizeCode}:${variant.cupCode}`)) {
      const fullIdentity = identityKey(key, variant);
      actualUnexpected.push(fullIdentity);
      actualByIdentity.set(fullIdentity, {
        id: String(row.id),
        productId: String(row.product_id),
        key,
        ...variant,
      });
    }
  }
  actualUnexpected.sort();

  if (JSON.stringify(actualUnexpected) !== JSON.stringify(approvedUnexpected)) {
    const approvedSet = new Set(approvedUnexpected);
    const actualSet = new Set(actualUnexpected);
    const newUnexpected = actualUnexpected.filter((key) => !approvedSet.has(key));
    const noLongerActive = approvedUnexpected.filter((key) => !actualSet.has(key));
    throw new Error(
      [
        "PostgreSQL không còn khớp variant reconciliation đã duyệt.",
        newUnexpected.length ? `Phát sinh ngoài review: ${newUnexpected.join(", ")}.` : "",
        noLongerActive.length ? `Không còn active: ${noLongerActive.join(", ")}.` : "",
      ].filter(Boolean).join(" "),
    );
  }

  for (const fullIdentity of approvedUnexpected) {
    const approvedItem = approvedByIdentity.get(fullIdentity);
    const actualItem = actualByIdentity.get(fullIdentity);
    if (!actualItem || actualItem.id !== approvedItem.id) {
      throw new Error(`Variant UUID đã lệch review: ${fullIdentity}.`);
    }
  }

  const targetVariantIds = approvedUnexpected.map((key) => actualByIdentity.get(key).id);
  const activeMappingResult = targetVariantIds.length
    ? await client.query(
        `SELECT id::text, product_id::text, color_id::text, variant_id::text
         FROM japan_underwear.product_color_variants
         WHERE variant_id = ANY($1::uuid[]) AND is_active = true
         ORDER BY variant_id, color_id`,
        [targetVariantIds],
      )
    : { rows: [] };
  if (activeMappingResult.rowCount > 0) {
    throw new Error(
      `Có ${activeMappingResult.rowCount} mapping active tham chiếu variant cần tắt. Dừng để review mapping riêng.`,
    );
  }

  for (const fullIdentity of approvedUnexpected) {
    console.log(`${fullIdentity.replace(/:([^:]+):([^:]+)$/, ":$1$2")} -> inactive`);
  }
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  if (!apply) {
    console.log("DRY RUN: chưa ghi PostgreSQL.");
    process.exit(0);
  }

  const protectedBefore = await readProtectedSnapshot();
  const protectedHashBefore = sha256(JSON.stringify(protectedBefore));
  const rowsToDeactivate = approvedUnexpected.map((fullIdentity) => {
    const row = actualByIdentity.get(fullIdentity);
    return {
      id: row.id,
      product_id: row.productId,
      size_code: row.sizeCode,
      cup_code: row.cupCode,
    };
  });

  const runResult = await client.query(
    `INSERT INTO japan_underwear.catalog_import_runs
       (source, status, manifest_hash, summary, started_at)
     VALUES ($1, 'running', $2, $3::jsonb, now())
     RETURNING id`,
    [
      "tuan-thuy-supplier-variant-reconciliation",
      sha256(approvedRaw),
      JSON.stringify({
        plannedProducts: products.length,
        plannedDeactivatedVariants: rowsToDeactivate.length,
        supplierManifestSha256: approved.sourceSupplierManifest.sha256,
        conflictAuditSha256: approved.sourceConflictAudit.sha256,
        protectedSnapshotSha256: protectedHashBefore,
      }),
    ],
  );
  runId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:supplier-variant-reconciliation'))",
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
    ["supplier-variant-reconciliation"],
  );
  await client.query(
    "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
    [crypto.randomUUID()],
  );

  const updateResult = await client.query(
    `UPDATE japan_underwear.product_variants AS variant
     SET is_active = false
     FROM jsonb_to_recordset($1::jsonb)
       AS input(id uuid, product_id uuid, size_code text, cup_code text)
     WHERE variant.id = input.id
       AND variant.product_id = input.product_id
       AND variant.size_code = input.size_code
       AND COALESCE(variant.cup_code, '') = input.cup_code
       AND variant.is_active = true
     RETURNING variant.id::text`,
    [JSON.stringify(rowsToDeactivate)],
  );
  if (updateResult.rowCount !== rowsToDeactivate.length) {
    throw new Error(
      `Số variant chuyển inactive lệch: ${updateResult.rowCount}/${rowsToDeactivate.length}.`,
    );
  }

  const remainingResult = await client.query(
    `SELECT product_id::text, size_code, COALESCE(cup_code, '') AS cup_code
     FROM japan_underwear.product_variants
     WHERE product_id = ANY($1::uuid[]) AND is_active = true`,
    [matchedSupplierIds],
  );
  const remainingUnexpected = [];
  for (const row of remainingResult.rows) {
    const key = keyByProductId.get(String(row.product_id));
    const variant = normalizeVariant({ sizeCode: row.size_code, cupCode: row.cup_code });
    const expected = new Set(
      (supplierVariantsByKey.get(key) ?? []).map((item) => `${item.sizeCode}:${item.cupCode}`),
    );
    if (!expected.has(`${variant.sizeCode}:${variant.cupCode}`)) {
      remainingUnexpected.push(identityKey(key, variant));
    }
  }
  if (remainingUnexpected.length) {
    throw new Error(`Hậu kiểm còn variant active ngoài supplier: ${remainingUnexpected.join(", ")}.`);
  }

  const protectedAfter = await readProtectedSnapshot();
  const protectedHashAfter = sha256(JSON.stringify(protectedAfter));
  if (
    JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore) ||
    protectedHashAfter !== protectedHashBefore
  ) {
    throw new Error(
      "Dữ liệu được bảo vệ thay đổi trong lúc reconcile variant; transaction đã bị hủy.",
    );
  }

  await client.query("COMMIT");
  transactionStarted = false;

  await client.query(
    `UPDATE japan_underwear.catalog_import_runs
     SET status = 'completed', summary = $2::jsonb, finished_at = now(), error_message = NULL
     WHERE id = $1`,
    [
      runId,
      JSON.stringify({
        reconciledProducts: products.length,
        deactivatedVariants: rowsToDeactivate.length,
        remainingUnexpectedActiveVariants: 0,
        supplierManifestSha256: approved.sourceSupplierManifest.sha256,
        conflictAuditSha256: approved.sourceConflictAudit.sha256,
        protectedSnapshotSha256Before: protectedHashBefore,
        protectedSnapshotSha256After: protectedHashAfter,
      }),
    ],
  );

  console.log("Supplier variant reconciliation OK.");
  console.log(`Variants marked inactive: ${rowsToDeactivate.length}.`);
  console.log("No rows deleted; products, colors, prices, mappings and historical orders unchanged.");
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
  if (runId) {
    await client.query(
      `UPDATE japan_underwear.catalog_import_runs
       SET status = 'failed', error_message = $2, finished_at = now()
       WHERE id = $1`,
      [runId, error instanceof Error ? error.message : String(error)],
    ).catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
