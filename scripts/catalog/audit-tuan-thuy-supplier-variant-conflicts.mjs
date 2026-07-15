import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument) {
  throw new Error(
    "Usage: node scripts/catalog/audit-tuan-thuy-supplier-variant-conflicts.mjs <supplier-color-variant-manifest.json> [output.json]",
  );
}

const manifestPath = path.resolve(cwd, manifestArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? "data/local/tuan-thuy-supplier-variant-conflicts.json",
);

loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

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

function variantKey(sizeCode, cupCode) {
  return `${clean(sizeCode)}:${clean(cupCode).toUpperCase()}`;
}

function displayVariant(variant) {
  return `${variant.sizeCode}${variant.cupCode}`;
}

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

function isRetryableConnectionError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "08000", "08001", "08003", "08006", "57P01"].includes(code) ||
    /timeout expired|connection terminated|connection closed|socket hang up/i.test(message)
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.products)) {
  throw new Error("Supplier color–size/cup manifest không hợp lệ.");
}

const expectedByKey = new Map();
for (const product of manifest.products) {
  const key = clean(product.key);
  parseKey(key);
  if (expectedByKey.has(key)) throw new Error(`Supplier product trùng: ${key}.`);
  const variants = (product.uniqueVariants ?? []).map((variant) => ({
    sizeCode: clean(variant.sizeCode),
    cupCode: clean(variant.cupCode).toUpperCase(),
  }));
  if (
    variants.length === 0 ||
    variants.some((variant) => !/^\d{2,3}$/.test(variant.sizeCode) || !/^[A-Z]+$/.test(variant.cupCode)) ||
    new Set(variants.map((variant) => variantKey(variant.sizeCode, variant.cupCode))).size !== variants.length
  ) {
    throw new Error(`Supplier variants không hợp lệ: ${key}.`);
  }
  expectedByKey.set(key, variants);
}

async function runAudit() {
  const client = new Client({
    connectionString,
    ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
    query_timeout: 120_000,
    keepAlive: true,
  });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        product.id::text AS product_id,
        brand.slug AS brand,
        category.slug AS category,
        product.model_code,
        variant.id::text AS variant_id,
        variant.size_code,
        COALESCE(variant.cup_code, '') AS cup_code,
        variant.is_active
      FROM japan_underwear.products AS product
      JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
      JOIN japan_underwear.categories AS category ON category.id = product.category_id
      LEFT JOIN japan_underwear.product_variants AS variant
        ON variant.product_id = product.id
       AND variant.is_active = true
      WHERE product.is_active = true
        AND category.slug = 'ao-nguc'
      ORDER BY brand.slug, product.model_code, variant.size_code, variant.cup_code, variant.id
    `);

    const actualByKey = new Map();
    for (const row of result.rows) {
      const key = `${row.brand}:${row.category}:${row.model_code}`;
      if (!expectedByKey.has(key)) continue;
      const current = actualByKey.get(key) ?? {
        productId: String(row.product_id),
        variants: [],
      };
      if (row.variant_id) {
        current.variants.push({
          id: String(row.variant_id),
          sizeCode: clean(row.size_code),
          cupCode: clean(row.cup_code).toUpperCase(),
        });
      }
      actualByKey.set(key, current);
    }

    const conflicts = [];
    const differences = [];
    for (const [key, supplierVariants] of expectedByKey) {
      const actual = actualByKey.get(key);
      if (!actual) continue;
      const expectedKeys = new Set(
        supplierVariants.map((variant) => variantKey(variant.sizeCode, variant.cupCode)),
      );
      const actualKeys = new Set(
        actual.variants.map((variant) => variantKey(variant.sizeCode, variant.cupCode)),
      );
      const unexpected = actual.variants.filter(
        (variant) => !expectedKeys.has(variantKey(variant.sizeCode, variant.cupCode)),
      );
      const missing = supplierVariants.filter(
        (variant) => !actualKeys.has(variantKey(variant.sizeCode, variant.cupCode)),
      );

      if (unexpected.length || missing.length) {
        const entry = {
          key,
          productId: actual.productId,
          actualActiveVariants: actual.variants,
          supplierCompleteVariants: supplierVariants,
          unexpectedActiveVariants: unexpected,
          missingSupplierVariants: missing,
        };
        differences.push(entry);
        if (unexpected.length) conflicts.push(entry);
      }
    }

    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      manifestPath,
      summary: {
        matchedProducts: actualByKey.size,
        productsWithDifferences: differences.length,
        productsWithUnexpectedActiveVariants: conflicts.length,
        unexpectedActiveVariantCount: conflicts.reduce(
          (sum, item) => sum + item.unexpectedActiveVariants.length,
          0,
        ),
        missingSupplierVariantCount: differences.reduce(
          (sum, item) => sum + item.missingSupplierVariants.length,
          0,
        ),
      },
      conflicts,
      differences,
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    console.log("=== Supplier variant conflict audit ===");
    console.log(`Matched supplier products: ${output.summary.matchedProducts}`);
    console.log(`Products with differences: ${output.summary.productsWithDifferences}`);
    console.log(
      `Products with unexpected active variants: ${output.summary.productsWithUnexpectedActiveVariants}`,
    );
    console.log(`Unexpected active variants: ${output.summary.unexpectedActiveVariantCount}`);
    console.log(`Missing supplier variants: ${output.summary.missingSupplierVariantCount}`);

    for (const item of conflicts) {
      console.log(`\n${item.key}`);
      console.log(
        `  PostgreSQL active: ${item.actualActiveVariants.map(displayVariant).join(", ") || "không"}`,
      );
      console.log(
        `  Supplier complete: ${item.supplierCompleteVariants.map(displayVariant).join(", ") || "không"}`,
      );
      console.log(
        `  Ngoài supplier: ${item.unexpectedActiveVariants.map(displayVariant).join(", ")}`,
      );
      console.log(
        `  Supplier còn thiếu trong DB: ${item.missingSupplierVariants.map(displayVariant).join(", ") || "không"}`,
      );
    }

    console.log(`\nOutput: ${outputPath}`);
    console.log("Audit chỉ đọc dữ liệu; không ghi PostgreSQL.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

let lastError;
for (let attempt = 1; attempt <= 4; attempt += 1) {
  try {
    await runAudit();
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    if (!isRetryableConnectionError(error) || attempt === 4) throw error;
    console.warn(`Kết nối PostgreSQL chưa sẵn sàng; thử lại ${attempt + 1}/4...`);
    await sleep(attempt * 2_000);
  }
}
if (lastError) throw lastError;
