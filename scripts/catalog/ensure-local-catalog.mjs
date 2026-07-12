import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

async function readCatalogCount() {
  const client = new Client({
    connectionString,
    ssl: isLocalDatabase(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const tableResult = await client.query(
      "SELECT to_regclass('japan_underwear.products') AS table_name",
    );

    if (!tableResult.rows[0]?.table_name) return 0;

    const countResult = await client.query(`
      SELECT COUNT(*)::integer AS count
      FROM japan_underwear.products
      WHERE source_product_id LIKE 'local:%'
    `);

    return Number(countResult.rows[0]?.count ?? 0);
  } finally {
    await client.end().catch(() => undefined);
  }
}

let currentCount;
try {
  currentCount = await readCatalogCount();
} catch (error) {
  console.error(
    `Không kiểm tra được catalog PostgreSQL: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

if (currentCount > 0) {
  console.log(`Catalog PostgreSQL đã sẵn sàng: ${currentCount} model.`);
  process.exit(0);
}

const requiredFiles = [
  path.resolve(cwd, "data", "local", "catalog-manifest.json"),
  path.resolve(cwd, "data", "local", "r2-upload-report.json"),
];
const missingFiles = requiredFiles.filter((filePath) => !existsSync(filePath));

if (missingFiles.length > 0) {
  console.error("Database đang có 0 model và thiếu dữ liệu local để tự import:");
  for (const filePath of missingFiles) console.error(`- ${filePath}`);
  process.exit(1);
}

console.log("Database đang có 0 model. Tự chạy migrate + verify + import trước khi mở dev server...");

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

const finalCount = await readCatalogCount();
if (finalCount < 1) {
  console.error("Bootstrap kết thúc nhưng PostgreSQL vẫn có 0 model.");
  process.exit(1);
}

console.log(`Catalog PostgreSQL đã sẵn sàng: ${finalCount} model.`);
