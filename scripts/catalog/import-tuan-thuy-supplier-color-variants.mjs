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
  if (!arg.startsWith("--")) continue;
  if (!["--apply", "--validate-only"].includes(arg)) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (apply && validateOnly) {
  throw new Error("Không được dùng đồng thời --apply và --validate-only.");
}
if (positional.length !== 2) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-supplier-color-variants.mjs <manifest.json> <source.xlsx> [--validate-only|--apply]",
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

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) {
    throw new Error(`Product key không hợp lệ: ${key}`);
  }
  return { brand, category, modelCode };
}

function variantKey(sizeCode, cupCode) {
  return `${clean(sizeCode)}:${clean(cupCode).toUpperCase()}`;
}

function validateManifest() {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Manifest schemaVersion phải là 1; nhận ${manifest.schemaVersion}.`);
  }

  const source = manifest.sourceSupplierFile;
  if (!source?.filename || !/^[a-f0-9]{64}$/i.test(clean(source.sha256))) {
    throw new Error("Manifest thiếu filename hoặc SHA-256 file Excel nguồn.");
  }
  const actualSourceHash = sha256(sourceBuffer);
  if (actualSourceHash !== clean(source.sha256).toLowerCase()) {
    throw new Error(
      `File Excel nguồn không khớp manifest: ${actualSourceHash}/${source.sha256}.`,
    );
  }

  const rules = manifest.businessRules ?? {};
  for (const rule of [
    "rowLevelColorVariantAvailability",
    "noCartesianProduct",
    "supplierRowsAreCompletePerColor",
    "noProductCreation",
    "noColorWrite",
    "noPriceWrite",
    "historicalOrdersUnchanged",
  ]) {
    if (rules[rule] !== true) {
      throw new Error(`Manifest thiếu quy tắc bắt buộc: ${rule}.`);
    }
  }

  const products = manifest.products ?? [];
  const expectedProductCount = Number(manifest.summary?.inScopeBraProductCount);
  if (
    !Number.isInteger(expectedProductCount) ||
    expectedProductCount <= 0 ||
    products.length !== expectedProductCount
  ) {
    throw new Error(`Số product lệch summary: ${products.length}/${expectedProductCount}.`);
  }

  const seenProducts = new Set();
  let colorCount = 0;
  let combinationCount = 0;
  const uniqueIdentities = new Set();
  let colorSpecificProductCount = 0;

  for (const product of products) {
    const key = clean(product.key);
    const identity = parseKey(key);
    if (seenProducts.has(key)) throw new Error(`Product trùng: ${key}.`);
    seenProducts.add(key);
    if (identity.category !== "ao-nguc") {
      throw new Error(`Importer chỉ nhận áo ngực; gặp ${key}.`);
    }
    if (!["pensee", "winking"].includes(identity.brand)) {
      throw new Error(`Brand không hợp lệ: ${key}.`);
    }
    if (!/^\d{4}$/.test(identity.modelCode)) {
      throw new Error(`Model code không hợp lệ: ${key}.`);
    }
    if (
      clean(product.brand) !== identity.brand ||
      clean(product.category) !== identity.category ||
      clean(product.modelCode) !== identity.modelCode
    ) {
      throw new Error(`Identity object không khớp key: ${key}.`);
    }

    const colors = product.colors ?? [];
    if (colors.length === 0) throw new Error(`Product ${key} không có dòng màu.`);
    const seenColors = new Set();
    const variantSets = new Set();
    const productIdentities = new Set();

    for (const color of colors) {
      const code = clean(color.code).toLowerCase();
      const name = clean(color.name);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || !name) {
        throw new Error(`Màu không hợp lệ: ${key}:${code}/${name}.`);
      }
      if (seenColors.has(code)) throw new Error(`Màu trùng: ${key}:${code}.`);
      seenColors.add(code);
      if (!Number.isInteger(Number(color.sourceRow)) || Number(color.sourceRow) < 1) {
        throw new Error(`Màu ${key}:${code} thiếu dòng Excel nguồn.`);
      }
      if (!clean(color.sourceSizeText)) {
        throw new Error(`Màu ${key}:${code} thiếu nội dung Kích cỡ nguồn.`);
      }

      const variants = color.variants ?? [];
      if (variants.length === 0) {
        throw new Error(`Màu ${key}:${code} không có size/cup.`);
      }
      const seenColorVariants = new Set();
      for (const variant of variants) {
        const sizeCode = clean(variant.sizeCode);
        const cupCode = clean(variant.cupCode).toUpperCase();
        if (!/^\d{2,3}$/.test(sizeCode) || !/^[A-Z]+$/.test(cupCode)) {
          throw new Error(`Size/cup không hợp lệ: ${key}:${code}:${sizeCode}${cupCode}.`);
        }
        if (clean(variant.label) !== `${sizeCode}${cupCode}`) {
          throw new Error(`Label size/cup không khớp: ${key}:${code}:${variant.label}.`);
        }
        const identityKey = variantKey(sizeCode, cupCode);
        if (seenColorVariants.has(identityKey)) {
          throw new Error(`Tổ hợp màu–size trùng: ${key}:${code}:${identityKey}.`);
        }
        seenColorVariants.add(identityKey);
        productIdentities.add(identityKey);
        uniqueIdentities.add(`${key}:${identityKey}`);
        combinationCount += 1;
      }
      variantSets.add([...seenColorVariants].sort().join("|"));
      colorCount += 1;
    }

    const declaredVariants = new Set(
      (product.uniqueVariants ?? []).map((variant) =>
        variantKey(variant.sizeCode, variant.cupCode),
      ),
    );
    if (
      declaredVariants.size !== productIdentities.size ||
      [...productIdentities].some((item) => !declaredVariants.has(item))
    ) {
      throw new Error(`uniqueVariants không khớp các dòng màu của ${key}.`);
    }
    if (variantSets.size > 1) colorSpecificProductCount += 1;
  }

  const summary = manifest.summary ?? {};
  const expected = {
    colors: Number(summary.inScopeColorCount),
    combinations: Number(summary.colorVariantCombinationCount),
    identities: Number(summary.productVariantIdentityCount),
    colorSpecific: Number(summary.productsWithColorSpecificVariantSets),
  };
  if (colorCount !== expected.colors) {
    throw new Error(`Tổng màu lệch summary: ${colorCount}/${expected.colors}.`);
  }
  if (combinationCount !== expected.combinations) {
    throw new Error(
      `Tổng quan hệ màu–size lệch summary: ${combinationCount}/${expected.combinations}.`,
    );
  }
  if (uniqueIdentities.size !== expected.identities) {
    throw new Error(
      `Tổng variant identity lệch summary: ${uniqueIdentities.size}/${expected.identities}.`,
    );
  }
  if (colorSpecificProductCount !== expected.colorSpecific) {
    throw new Error(
      `Số product có size theo màu lệch: ${colorSpecificProductCount}/${expected.colorSpecific}.`,
    );
  }

  const targetCoverage = manifest.targetCoverage ?? [];
  if (
    Number(summary.targetMissingSizeCupProductCount) !== 30 ||
    targetCoverage.length !== 30
  ) {
    throw new Error("Manifest phải đối chiếu đúng baseline 30 mã thiếu size/cup.");
  }
  const covered = targetCoverage.filter((item) => item.present === true).length;
  const missing = targetCoverage.length - covered;
  if (
    covered !== Number(summary.targetProductsCovered) ||
    missing !== Number(summary.targetProductsStillMissing)
  ) {
    throw new Error(`Coverage 30 mã lệch summary: ${covered}/${missing}.`);
  }

  return {
    products,
    sourceHash: actualSourceHash,
    colorCount,
    combinationCount,
    identityCount: uniqueIdentities.size,
    colorSpecificProductCount,
    targetCovered: covered,
    targetMissing: missing,
  };
}

const validated = validateManifest();
console.log("=== Tuấn Thủy supplier color–size/cup data ===");
console.log(`Manifest: ${manifestPath}`);
console.log(`Source Excel: ${sourcePath}`);
console.log(`Source SHA-256: ${validated.sourceHash}`);
console.log(`Supplier bras: ${validated.products.length}`);
console.log(`Supplier colors: ${validated.colorCount}`);
console.log(`Exact color–size/cup combinations: ${validated.combinationCount}`);
console.log(`Product variant identities: ${validated.identityCount}`);
console.log(`Products with color-specific size sets: ${validated.colorSpecificProductCount}`);
console.log(
  `Baseline 30 thiếu size/cup: có nguồn ${validated.targetCovered}; còn thiếu ${validated.targetMissing}.`,
);

if (validateOnly) {
  console.log("VALIDATE ONLY: manifest và Excel khớp; chưa kết nối PostgreSQL.");
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

async function readProtectedSnapshot() {
  const [products, colors, orders, orderItems] = await Promise.all([
    client.query(`
      SELECT id::text, base_price, currency, is_active, short_description
      FROM japan_underwear.products
      ORDER BY id
    `),
    client.query(`
      SELECT id::text, product_id::text, code, name, swatch, sort_order, is_active
      FROM japan_underwear.product_colors
      ORDER BY id
    `),
    client.query(`
      SELECT id::text, order_code, status, subtotal, currency, created_at
      FROM japan_underwear.orders
      ORDER BY id
    `),
    client.query(`
      SELECT id::text, order_id::text, product_variant_id::text, color_id::text,
             quantity, unit_price, line_total, product_code_snapshot,
             product_name_snapshot, color_code_snapshot, color_name_snapshot,
             size_code_snapshot, COALESCE(cup_code_snapshot, '') AS cup_code_snapshot
      FROM japan_underwear.order_items
      ORDER BY id
    `),
  ]);
  return {
    products: products.rows,
    colors: colors.rows,
    orders: orders.rows,
    orderItems: orderItems.rows,
  };
}

try {
  await client.connect();
  const schemaResult = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.product_colors') AS colors_table,
      to_regclass('japan_underwear.product_variants') AS variants_table,
      to_regclass('japan_underwear.product_color_variants') AS availability_table,
      to_regclass('japan_underwear.catalog_import_runs') AS runs_table
  `);
  const schema = schemaResult.rows[0];
  if (
    !schema.products_table ||
    !schema.colors_table ||
    !schema.variants_table ||
    !schema.availability_table ||
    !schema.runs_table
  ) {
    throw new Error("Schema color–size/cup chưa sẵn sàng. Chạy npm run db:migrate.");
  }

  const productResult = await client.query(`
    SELECT product.id::text, brand.slug AS brand, category.slug AS category,
           product.model_code
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
  const matchedProducts = validated.products
    .map((product) => {
      const database = productByKey.get(clean(product.key));
      return database ? { manifest: product, database } : null;
    })
    .filter(Boolean);
  const supplierNotActive = validated.products
    .filter((product) => !productByKey.has(clean(product.key)))
    .map((product) => clean(product.key));
  const matchedIds = matchedProducts.map((item) => item.database.id);

  const [colorResult, variantResult, availabilityResult] = matchedIds.length
    ? await Promise.all([
        client.query(
          `SELECT id::text, product_id::text, code, name, is_active
           FROM japan_underwear.product_colors
           WHERE product_id = ANY($1::uuid[])
           ORDER BY product_id, code`,
          [matchedIds],
        ),
        client.query(
          `SELECT id::text, product_id::text, size_code,
                  COALESCE(cup_code, '') AS cup_code, is_active
           FROM japan_underwear.product_variants
           WHERE product_id = ANY($1::uuid[])
           ORDER BY product_id, size_code, cup_code`,
          [matchedIds],
        ),
        client.query(
          `SELECT id::text, product_id::text, color_id::text, variant_id::text,
                  source, is_active
           FROM japan_underwear.product_color_variants
           WHERE product_id = ANY($1::uuid[])
           ORDER BY product_id, color_id, variant_id`,
          [matchedIds],
        ),
      ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }];

  const colorsByProduct = new Map();
  for (const row of colorResult.rows) {
    const map = colorsByProduct.get(String(row.product_id)) ?? new Map();
    map.set(clean(row.code).toLowerCase(), row);
    colorsByProduct.set(String(row.product_id), map);
  }
  const variantsByProduct = new Map();
  for (const row of variantResult.rows) {
    const map = variantsByProduct.get(String(row.product_id)) ?? new Map();
    map.set(variantKey(row.size_code, row.cup_code), row);
    variantsByProduct.set(String(row.product_id), map);
  }

  const expectedVariantKeysByProduct = new Map();
  const expectedPairs = [];
  const missingColors = [];
  for (const item of matchedProducts) {
    const productId = item.database.id;
    const expectedVariants = new Set();
    const colorMap = colorsByProduct.get(productId) ?? new Map();
    for (const color of item.manifest.colors) {
      const colorRow = colorMap.get(clean(color.code).toLowerCase());
      if (!colorRow || !colorRow.is_active) {
        missingColors.push(`${item.manifest.key}:${color.code}`);
        continue;
      }
      for (const variant of color.variants) {
        const key = variantKey(variant.sizeCode, variant.cupCode);
        expectedVariants.add(key);
        expectedPairs.push({
          productId,
          productKey: clean(item.manifest.key),
          colorId: String(colorRow.id),
          colorCode: clean(color.code).toLowerCase(),
          sizeCode: clean(variant.sizeCode),
          cupCode: clean(variant.cupCode).toUpperCase(),
          source: `tuan-thuy-supplier-xlsx:${item.manifest.sourceSheet}:${color.sourceRow}`,
        });
      }
    }
    expectedVariantKeysByProduct.set(productId, expectedVariants);
  }
  if (missingColors.length) {
    throw new Error(`Màu active trong DB thiếu so với Excel: ${missingColors.join(", ")}.`);
  }

  const unexpectedActiveVariants = variantResult.rows.filter((row) => {
    if (!row.is_active) return false;
    const expected = expectedVariantKeysByProduct.get(String(row.product_id));
    return expected && !expected.has(variantKey(row.size_code, row.cup_code));
  });

  const existingVariantByIdentity = new Map();
  for (const item of matchedProducts) {
    const variantMap = variantsByProduct.get(item.database.id) ?? new Map();
    for (const [key, row] of variantMap) {
      existingVariantByIdentity.set(`${item.database.id}:${key}`, row);
    }
  }
  const variantsToCreate = [];
  const variantsToReactivate = [];
  for (const item of matchedProducts) {
    for (const variant of item.manifest.uniqueVariants) {
      const key = variantKey(variant.sizeCode, variant.cupCode);
      const existing = existingVariantByIdentity.get(`${item.database.id}:${key}`);
      if (!existing) {
        variantsToCreate.push({
          productId: item.database.id,
          productKey: clean(item.manifest.key),
          sizeCode: clean(variant.sizeCode),
          cupCode: clean(variant.cupCode).toUpperCase(),
        });
      } else if (!existing.is_active) {
        variantsToReactivate.push(existing);
      }
    }
  }

  const expectedPairIdentity = new Set(
    expectedPairs.map(
      (pair) => `${pair.productId}:${pair.colorId}:${variantKey(pair.sizeCode, pair.cupCode)}`,
    ),
  );
  const variantIdentityById = new Map(
    variantResult.rows.map((row) => [
      String(row.id),
      variantKey(row.size_code, row.cup_code),
    ]),
  );
  const unexpectedActiveMappings = availabilityResult.rows.filter((row) => {
    if (!row.is_active) return false;
    const variantIdentity = variantIdentityById.get(String(row.variant_id));
    if (!variantIdentity) return true;
    return !expectedPairIdentity.has(
      `${row.product_id}:${row.color_id}:${variantIdentity}`,
    );
  });

  console.log(`Active bras in PostgreSQL: ${activeProducts.length}`);
  console.log(`Matched supplier products: ${matchedProducts.length}`);
  console.log(`Supplier products not active in app: ${supplierNotActive.length}`);
  console.log(`Exact mappings planned: ${expectedPairs.length}`);
  console.log(`Variants to create: ${variantsToCreate.length}`);
  console.log(`Variants to reactivate: ${variantsToReactivate.length}`);
  console.log(`Unexpected active variants: ${unexpectedActiveVariants.length}`);
  console.log(`Unexpected active mappings: ${unexpectedActiveMappings.length}`);
  if (supplierNotActive.length) {
    console.log(`Supplier-only: ${supplierNotActive.join(", ")}`);
  }
  if (unexpectedActiveVariants.length) {
    console.log(
      `Variant conflicts: ${unexpectedActiveVariants
        .map((row) => `${row.product_id}:${row.size_code}${row.cup_code}`)
        .join(", ")}`,
    );
    throw new Error(
      "PostgreSQL có size/cup active ngoài hợp đầy đủ của Excel. Dừng để review, không tự tắt.",
    );
  }
  if (unexpectedActiveMappings.length) {
    console.log(
      `Mapping conflicts: ${unexpectedActiveMappings
        .map((row) => `${row.product_id}:${row.color_id}:${row.variant_id}`)
        .join(", ")}`,
    );
    throw new Error(
      "PostgreSQL có quan hệ màu–size/cup active ngoài Excel. Dừng để review, không tự tắt.",
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

  const protectedBefore = await readProtectedSnapshot();
  const protectedHashBefore = sha256(JSON.stringify(protectedBefore));
  const runResult = await client.query(
    `INSERT INTO japan_underwear.catalog_import_runs
       (source, status, manifest_hash, summary, started_at)
     VALUES ($1, 'running', $2, $3::jsonb, now())
     RETURNING id`,
    [
      "tuan-thuy-supplier-color-variants",
      sha256(manifestRaw),
      JSON.stringify({
        sourceFile: manifest.sourceSupplierFile.filename,
        sourceSha256: validated.sourceHash,
        matchedProducts: matchedProducts.length,
        plannedMappings: expectedPairs.length,
        plannedNewVariants: variantsToCreate.length,
        supplierNotActive,
        protectedSnapshotSha256: protectedHashBefore,
      }),
    ],
  );
  runId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:supplier-color-variants'))",
  );

  const variantIdByProductIdentity = new Map();
  for (const item of matchedProducts) {
    for (const variant of item.manifest.uniqueVariants) {
      const sizeCode = clean(variant.sizeCode);
      const cupCode = clean(variant.cupCode).toUpperCase();
      const existing = await client.query(
        `SELECT id::text, is_active
         FROM japan_underwear.product_variants
         WHERE product_id = $1::uuid
           AND size_code = $2
           AND cup_code IS NOT DISTINCT FROM $3::text
         LIMIT 1
         FOR UPDATE`,
        [item.database.id, sizeCode, cupCode],
      );
      let variantId;
      if (existing.rowCount === 1) {
        variantId = String(existing.rows[0].id);
        if (!existing.rows[0].is_active) {
          await client.query(
            `UPDATE japan_underwear.product_variants
             SET is_active = true
             WHERE id = $1::uuid`,
            [variantId],
          );
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO japan_underwear.product_variants
             (product_id, size_code, cup_code, sku, price_override, is_active)
           VALUES ($1::uuid, $2, $3, NULL, NULL, true)
           RETURNING id::text`,
          [item.database.id, sizeCode, cupCode],
        );
        variantId = String(inserted.rows[0].id);
      }
      variantIdByProductIdentity.set(
        `${item.database.id}:${variantKey(sizeCode, cupCode)}`,
        variantId,
      );
    }
  }

  const resolvedMappings = expectedPairs.map((pair) => {
    const variantId = variantIdByProductIdentity.get(
      `${pair.productId}:${variantKey(pair.sizeCode, pair.cupCode)}`,
    );
    if (!variantId) {
      throw new Error(
        `Không resolve được variant sau upsert: ${pair.productKey}:${pair.colorCode}:${pair.sizeCode}${pair.cupCode}.`,
      );
    }
    return { ...pair, variantId };
  });

  await client.query(
    `INSERT INTO japan_underwear.product_color_variants
       (product_id, color_id, variant_id, source, is_active)
     SELECT input.product_id, input.color_id, input.variant_id, input.source, true
     FROM jsonb_to_recordset($1::jsonb)
       AS input(product_id uuid, color_id uuid, variant_id uuid, source text)
     ON CONFLICT (color_id, variant_id)
     DO UPDATE SET
       product_id = EXCLUDED.product_id,
       source = EXCLUDED.source,
       is_active = true,
       updated_at = now()`,
    [JSON.stringify(resolvedMappings)],
  );

  const activeMappingResult = await client.query(
    `SELECT availability.product_id::text, availability.color_id::text,
            availability.variant_id::text, variant.size_code,
            COALESCE(variant.cup_code, '') AS cup_code
     FROM japan_underwear.product_color_variants AS availability
     JOIN japan_underwear.product_variants AS variant
       ON variant.id = availability.variant_id
     WHERE availability.product_id = ANY($1::uuid[])
       AND availability.is_active = true
     ORDER BY availability.product_id, availability.color_id,
              variant.size_code, variant.cup_code`,
    [matchedIds],
  );
  const actualPairIdentity = new Set(
    activeMappingResult.rows.map(
      (row) =>
        `${row.product_id}:${row.color_id}:${variantKey(row.size_code, row.cup_code)}`,
    ),
  );
  const expectedResolvedIdentity = new Set(
    resolvedMappings.map(
      (row) =>
        `${row.productId}:${row.colorId}:${variantKey(row.sizeCode, row.cupCode)}`,
    ),
  );
  if (
    actualPairIdentity.size !== expectedResolvedIdentity.size ||
    [...expectedResolvedIdentity].some((identity) => !actualPairIdentity.has(identity))
  ) {
    throw new Error(
      `Hậu kiểm quan hệ màu–size/cup thất bại: ${actualPairIdentity.size}/${expectedResolvedIdentity.size}.`,
    );
  }

  const protectedAfter = await readProtectedSnapshot();
  const protectedHashAfter = sha256(JSON.stringify(protectedAfter));
  if (
    protectedHashAfter !== protectedHashBefore ||
    JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore)
  ) {
    throw new Error(
      "Product, color, price hoặc đơn lịch sử thay đổi trong lúc import; transaction đã bị hủy.",
    );
  }

  const orderableResult = await client.query(`
    SELECT COUNT(DISTINCT product.id)::integer AS count
    FROM japan_underwear.products AS product
    JOIN japan_underwear.product_color_variants AS availability
      ON availability.product_id = product.id AND availability.is_active = true
    JOIN japan_underwear.product_colors AS color
      ON color.id = availability.color_id AND color.is_active = true
    JOIN japan_underwear.product_variants AS variant
      ON variant.id = availability.variant_id AND variant.is_active = true
    WHERE product.is_active = true
  `);

  await client.query("COMMIT");
  transactionStarted = false;
  await client.query(
    `UPDATE japan_underwear.catalog_import_runs
     SET status = 'completed', summary = $2::jsonb,
         finished_at = now(), error_message = NULL
     WHERE id = $1`,
    [
      runId,
      JSON.stringify({
        sourceFile: manifest.sourceSupplierFile.filename,
        sourceSha256: validated.sourceHash,
        matchedProducts: matchedProducts.length,
        activeMappings: resolvedMappings.length,
        createdVariants: variantsToCreate.length,
        reactivatedVariants: variantsToReactivate.length,
        orderableProducts: Number(orderableResult.rows[0].count),
        supplierNotActive,
        protectedSnapshotSha256Before: protectedHashBefore,
        protectedSnapshotSha256After: protectedHashAfter,
      }),
    ],
  );

  console.log("Supplier color–size/cup import OK.");
  console.log(`Products matched: ${matchedProducts.length}.`);
  console.log(`Exact mappings active: ${resolvedMappings.length}.`);
  console.log(`Variants created: ${variantsToCreate.length}.`);
  console.log(`Orderable products: ${orderableResult.rows[0].count}.`);
  console.log("Products, colors, prices and historical orders were not updated.");
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
  if (runId) {
    await client
      .query(
        `UPDATE japan_underwear.catalog_import_runs
         SET status = 'failed', error_message = $2, finished_at = now()
         WHERE id = $1`,
        [runId, error instanceof Error ? error.message : String(error)],
      )
      .catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
