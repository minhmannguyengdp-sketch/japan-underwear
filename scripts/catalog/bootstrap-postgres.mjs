import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Thiếu DATABASE_URL trong .env.local.");

const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ??
    path.join(cwd, "data", "local", "r2-upload-report.json"),
);

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Không đọc được ${label} tại ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function runNodeStep(label, entryPath, args = []) {
  if (!existsSync(entryPath)) throw new Error(`Không tìm thấy ${label}: ${entryPath}`);
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} thất bại với mã ${result.status}.`);
}

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

const productIdentityScriptPath = path.resolve(
  cwd,
  "scripts",
  "db",
  "apply-product-identity.mjs",
);
const verifyScriptPath = path.resolve(
  cwd,
  "scripts",
  "db",
  "verify-catalog-migration.mjs",
);
const importerScriptPath = path.resolve(
  cwd,
  "scripts",
  "catalog",
  "import-postgres.mjs",
);

const [manifest, report] = await Promise.all([
  readJson(manifestPath, "catalog manifest"),
  readJson(reportPath, "R2 upload report"),
]);
const expectedProducts = Number(manifest.summary?.productGroupCount ?? 0);
const expectedImages = Number(manifest.summary?.matchedImageCount ?? -1);
const expectedNoImage = Number(manifest.summary?.retainedWithoutImagesCount ?? 0);
const reportImages = Array.isArray(report.objects) ? report.objects.length : -1;

if (!Number.isInteger(expectedProducts) || expectedProducts < 1) {
  throw new Error("Manifest không có productGroupCount hợp lệ.");
}
if (!Number.isInteger(expectedImages) || expectedImages < 0) {
  throw new Error("Manifest không có matchedImageCount hợp lệ.");
}
if (!Number.isInteger(expectedNoImage) || expectedNoImage < 0) {
  throw new Error("Manifest không có retainedWithoutImagesCount hợp lệ.");
}
if (reportImages !== expectedImages) {
  throw new Error(
    `R2 report chưa khớp manifest active: objects=${reportImages}, expected=${expectedImages}. Chạy npm run catalog:sync.`,
  );
}

console.log("\n=== Catalog bootstrap ===");
console.log(`Database host: ${new URL(connectionString).hostname}`);
console.log(`Expected active products: ${expectedProducts}`);
console.log(`Expected images: ${expectedImages}`);
console.log(`Expected active products without images: ${expectedNoImage}`);

console.log("\n[1/4] Chuẩn hóa migration product identity...");
runNodeStep("Product identity migration", productIdentityScriptPath);

console.log("\n[2/4] Kiểm tra schema...");
runNodeStep("Catalog DB verification", verifyScriptPath);

console.log("\n[3/4] Import catalog...");
runNodeStep("Catalog PostgreSQL import", importerScriptPath, ["--apply"]);

console.log("\n[4/4] Hậu kiểm dữ liệu active...");
const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.products
        WHERE source_product_id LIKE 'local:%'
          AND is_active = true
      ) AS products,
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.product_images AS image
        JOIN japan_underwear.products AS product ON product.id = image.product_id
        WHERE product.source_product_id LIKE 'local:%'
          AND product.is_active = true
      ) AS images,
      (
        SELECT COUNT(*)::integer
        FROM (
          SELECT product.id
          FROM japan_underwear.products AS product
          LEFT JOIN japan_underwear.product_images AS image ON image.product_id = product.id
          WHERE product.source_product_id LIKE 'local:%'
            AND product.is_active = true
          GROUP BY product.id
          HAVING COUNT(image.id) = 0
        ) AS no_image
      ) AS no_image_products,
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.catalog_import_runs
        WHERE status = 'completed'
      ) AS completed_imports
  `);

  const row = result.rows[0];
  const products = Number(row.products);
  const images = Number(row.images);
  const noImageProducts = Number(row.no_image_products);
  const completedImports = Number(row.completed_imports);
  console.table([{ products, images, noImageProducts, completedImports }]);

  if (
    products !== expectedProducts ||
    images !== expectedImages ||
    noImageProducts !== expectedNoImage
  ) {
    throw new Error(
      `Hậu kiểm thất bại: products=${products}/${expectedProducts}, images=${images}/${expectedImages}, noImage=${noImageProducts}/${expectedNoImage}.`,
    );
  }

  console.log("\nCatalog bootstrap OK.");
  console.log(
    `Active products: ${products}. Images: ${images}. Active without images: ${noImageProducts}.`,
  );
} finally {
  await client.end().catch(() => undefined);
}
