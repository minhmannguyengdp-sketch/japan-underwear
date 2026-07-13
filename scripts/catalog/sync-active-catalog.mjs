import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

function runStep(label, relativePath, args = []) {
  const scriptPath = path.resolve(cwd, ...relativePath);
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status}.`);
  }
}

console.log("\nĐồng bộ catalog active theo bảng giá + ảnh đã duyệt.");
console.log("Pipeline: audit strict → R2 apply → PostgreSQL bootstrap.");

runStep(
  "1/3 Audit catalog",
  ["scripts", "catalog", "audit-price-authoritative-catalog.mjs"],
  ["--strict"],
);
runStep(
  "2/3 Đồng bộ Cloudflare R2",
  ["scripts", "catalog", "upload-r2.mjs"],
  ["--apply"],
);
runStep(
  "3/3 Đồng bộ PostgreSQL",
  ["scripts", "catalog", "bootstrap-postgres.mjs"],
);

console.log("\nCatalog active đã đồng bộ hoàn tất.");
console.log("Chạy npm run dev để mở http://localhost:3100");
