import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();

function runNodeScript(relativePath, label) {
  const scriptPath = path.resolve(cwd, relativePath);
  console.log(`\n=== ${label} ===`);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status ?? "unknown"}.`);
  }
}

console.log("Kiểm tra migration order variant...");
runNodeScript("scripts/db/migrate-catalog.mjs", "Catalog migrations");
runNodeScript("scripts/db/verify-catalog-migration.mjs", "Catalog DB verification");
await import("./ensure-local-catalog.mjs");
