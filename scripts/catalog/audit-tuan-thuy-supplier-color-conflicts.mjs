import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument) {
  throw new Error(
    "Usage: node scripts/catalog/audit-tuan-thuy-supplier-color-conflicts.mjs <supplier-manifest.json> [output.json]",
  );
}

const manifestPath = path.resolve(cwd, manifestArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? "data/local/tuan-thuy-supplier-color-conflicts.json",
);

loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.products)) {
  throw new Error("Supplier manifest không hợp lệ.");
}

const expectedByKey = new Map();
for (const product of manifest.products) {
  const key = clean(product.key);
  const colors = (product.colors ?? []).map((color) => ({
    code: clean(color.code).toLowerCase(),
    name: clean(color.name),
  }));
  expectedByKey.set(key, colors);
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 120_000,
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      product.id::text AS product_id,
      brand.slug AS brand,
      category.slug AS category,
      product.model_code,
      color.code,
      color.name,
      color.sort_order
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    LEFT JOIN japan_underwear.product_colors AS color
      ON color.product_id = product.id
     AND color.is_active = true
    WHERE product.is_active = true
      AND category.slug = 'ao-nguc'
    ORDER BY brand.slug, product.model_code, color.sort_order, color.code
  `);

  const actualByKey = new Map();
  for (const row of result.rows) {
    const key = `${row.brand}:${row.category}:${row.model_code}`;
    if (!expectedByKey.has(key)) continue;
    const current = actualByKey.get(key) ?? [];
    if (row.code) {
      current.push({
        code: clean(row.code).toLowerCase(),
        name: clean(row.name),
        sortOrder: Number(row.sort_order),
      });
    }
    actualByKey.set(key, current);
  }

  const conflicts = [];
  const differences = [];
  for (const [key, expectedColors] of expectedByKey) {
    if (!actualByKey.has(key)) continue;
    const actualColors = actualByKey.get(key) ?? [];
    const expectedCodes = new Set(expectedColors.map((color) => color.code));
    const actualCodes = new Set(actualColors.map((color) => color.code));
    const unexpected = actualColors.filter((color) => !expectedCodes.has(color.code));
    const missing = expectedColors.filter((color) => !actualCodes.has(color.code));

    if (unexpected.length || missing.length) {
      const entry = {
        key,
        actualActiveColors: actualColors,
        supplierColors: expectedColors,
        unexpectedActiveColors: unexpected,
        missingSupplierColors: missing,
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
      productsWithUnexpectedActiveColors: conflicts.length,
      unexpectedActiveColorCount: conflicts.reduce(
        (sum, item) => sum + item.unexpectedActiveColors.length,
        0,
      ),
      missingSupplierColorCount: differences.reduce(
        (sum, item) => sum + item.missingSupplierColors.length,
        0,
      ),
    },
    conflicts,
    differences,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("=== Supplier color conflict audit ===");
  console.log(`Matched supplier products: ${output.summary.matchedProducts}`);
  console.log(`Products with differences: ${output.summary.productsWithDifferences}`);
  console.log(
    `Products with unexpected active colors: ${output.summary.productsWithUnexpectedActiveColors}`,
  );
  console.log(`Unexpected active colors: ${output.summary.unexpectedActiveColorCount}`);
  console.log(`Missing supplier colors: ${output.summary.missingSupplierColorCount}`);

  for (const item of conflicts) {
    console.log(`\n${item.key}`);
    console.log(
      `  PostgreSQL active: ${item.actualActiveColors.map((color) => color.name).join(", ") || "không"}`,
    );
    console.log(
      `  Supplier complete: ${item.supplierColors.map((color) => color.name).join(", ") || "không"}`,
    );
    console.log(
      `  Ngoài supplier: ${item.unexpectedActiveColors.map((color) => color.name).join(", ")}`,
    );
    console.log(
      `  Supplier còn thiếu trong DB: ${item.missingSupplierColors.map((color) => color.name).join(", ") || "không"}`,
    );
  }

  console.log(`\nOutput: ${outputPath}`);
  console.log("Audit chỉ đọc dữ liệu; không ghi PostgreSQL.");
} finally {
  await client.end().catch(() => undefined);
}
