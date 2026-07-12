import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Thiếu DATABASE_URL trong .env.local. Không thể chuẩn bị catalog local.");
  process.exit(1);
}

const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ??
    path.join(cwd, "data", "local", "r2-upload-report.json"),
);

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

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

async function readCatalogState() {
  const client = new Client({
    connectionString,
    ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const tableResult = await client.query(
      "SELECT to_regclass('japan_underwear.products') AS table_name",
    );
    if (!tableResult.rows[0]?.table_name) {
      return { products: 0, images: 0, noImageProducts: 0 };
    }

    const result = await client.query(`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products
          WHERE source_product_id LIKE 'local:%' AND is_active = true
        ) AS products,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_images AS image
          JOIN japan_underwear.products AS product ON product.id = image.product_id
          WHERE product.source_product_id LIKE 'local:%' AND product.is_active = true
        ) AS images,
        (
          SELECT COUNT(*)::integer
          FROM (
            SELECT product.id
            FROM japan_underwear.products AS product
            LEFT JOIN japan_underwear.product_images AS image ON image.product_id = product.id
            WHERE product.source_product_id LIKE 'local:%' AND product.is_active = true
            GROUP BY product.id
            HAVING COUNT(image.id) = 0
          ) AS no_image
        ) AS no_image_products
    `);
    return {
      products: Number(result.rows[0]?.products ?? 0),
      images: Number(result.rows[0]?.images ?? 0),
      noImageProducts: Number(result.rows[0]?.no_image_products ?? 0),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const requiredFiles = [manifestPath, reportPath];
const missingFiles = requiredFiles.filter((filePath) => !existsSync(filePath));
if (missingFiles.length > 0) {
  console.error("Thiếu dữ liệu local để xác định phiên bản catalog:");
  for (const filePath of missingFiles) console.error(`- ${filePath}`);
  process.exit(1);
}

let manifest;
let report;
let current;
try {
  [manifest, report, current] = await Promise.all([
    readJson(manifestPath, "catalog manifest"),
    readJson(reportPath, "R2 upload report"),
    readCatalogState(),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const expected = {
  products: Number(manifest.summary?.productGroupCount ?? -1),
  images: Number(manifest.summary?.matchedImageCount ?? -1),
  noImageProducts: Number(manifest.summary?.retainedWithoutImagesCount ?? 0),
};
const reportImages = Array.isArray(report.objects) ? report.objects.length : -1;
const reportProducts = Number(report.manifest?.productCount ?? -1);

if (
  report.mode !== "apply" ||
  reportImages !== expected.images ||
  reportProducts !== expected.products
) {
  console.error(
    `Manifest/R2 report chưa đồng bộ: manifest=${expected.products} model/${expected.images} ảnh, report=${reportProducts} model/${reportImages} ảnh.`,
  );
  console.error("Chạy: npm run catalog:sync");
  process.exit(1);
}

if (
  current.products === expected.products &&
  current.images === expected.images &&
  current.noImageProducts === expected.noImageProducts
) {
  console.log(
    `Catalog PostgreSQL đã sẵn sàng: ${current.products} model active, ${current.images} ảnh, ${current.noImageProducts} model chưa có ảnh.`,
  );
  process.exit(0);
}

console.log(
  `Catalog PostgreSQL chưa khớp manifest: hiện ${current.products}/${current.images}/${current.noImageProducts}, cần ${expected.products}/${expected.images}/${expected.noImageProducts}. Tự đồng bộ DB...`,
);
const bootstrapScript = path.resolve(
  cwd,
  "scripts",
  "catalog",
  "bootstrap-postgres.mjs",
);
const bootstrap = spawnSync(process.execPath, [bootstrapScript], {
  cwd,
  env: process.env,
  stdio: "inherit",
  shell: false,
});
if (bootstrap.error) throw bootstrap.error;
if (bootstrap.status !== 0) {
  console.error(`Catalog bootstrap thất bại với mã ${bootstrap.status}.`);
  process.exit(bootstrap.status ?? 1);
}

const finalState = await readCatalogState();
if (
  finalState.products !== expected.products ||
  finalState.images !== expected.images ||
  finalState.noImageProducts !== expected.noImageProducts
) {
  console.error(
    `Bootstrap kết thúc nhưng DB vẫn lệch: ${finalState.products}/${finalState.images}/${finalState.noImageProducts}.`,
  );
  process.exit(1);
}
console.log(
  `Catalog PostgreSQL đã sẵn sàng: ${finalState.products} model active, ${finalState.images} ảnh, ${finalState.noImageProducts} model chưa có ảnh.`,
);
