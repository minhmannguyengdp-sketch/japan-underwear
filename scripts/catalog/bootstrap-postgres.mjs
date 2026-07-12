import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("Thiếu DATABASE_URL trong .env.local.");
}

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

function runNpm(script, extraArgs = []) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["run", script, ...extraArgs],
    {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: false,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Bước npm run ${script} thất bại với mã ${result.status}.`);
  }
}

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

const [manifest, report] = await Promise.all([
  readJson(manifestPath, "catalog manifest"),
  readJson(reportPath, "R2 upload report"),
]);

const expectedProducts = Number(manifest.summary?.productGroupCount ?? 0);
const expectedImages = Array.isArray(report.objects) ? report.objects.length : 0;

if (!Number.isInteger(expectedProducts) || expectedProducts < 1) {
  throw new Error("Manifest không có productGroupCount hợp lệ.");
}
if (!Number.isInteger(expectedImages) || expectedImages < 1) {
  throw new Error("R2 report không có objects hợp lệ.");
}

console.log("\n=== Catalog bootstrap ===");
console.log(`Database host: ${new URL(connectionString).hostname}`);
console.log(`Expected products: ${expectedProducts}`);
console.log(`Expected images: ${expectedImages}`);

console.log("\n[1/4] Chạy migration...");
runNpm("db:migrate");

console.log("\n[2/4] Kiểm tra schema...");
runNpm("db:verify");

console.log("\n[3/4] Import catalog...");
runNpm("catalog:db:import", ["--", "--apply"]);

console.log("\n[4/4] Hậu kiểm dữ liệu...");
const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.products
        WHERE source_product_id LIKE 'local:%'
      ) AS products,
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.product_images AS image
        JOIN japan_underwear.products AS product
          ON product.id = image.product_id
        WHERE product.source_product_id LIKE 'local:%'
      ) AS images,
      (
        SELECT COUNT(*)::integer
        FROM japan_underwear.catalog_import_runs
        WHERE status = 'completed'
      ) AS completed_imports
  `);

  const row = result.rows[0];
  const products = Number(row.products);
  const images = Number(row.images);
  const completedImports = Number(row.completed_imports);

  console.table([{ products, images, completedImports }]);

  if (products !== expectedProducts || images !== expectedImages) {
    throw new Error(
      `Hậu kiểm thất bại: products=${products}/${expectedProducts}, images=${images}/${expectedImages}.`,
    );
  }

  console.log("\nCatalog bootstrap OK.");
  console.log(`Products: ${products}. Images: ${images}.`);
  console.log("Bây giờ chạy: npm run dev");
} finally {
  await client.end().catch(() => undefined);
}
