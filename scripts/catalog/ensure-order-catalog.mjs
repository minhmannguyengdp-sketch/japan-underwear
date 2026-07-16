import path from "node:path";
import process from "node:process";

import { runProcessWithDatabaseRetry } from "../db/run-process-with-db-retry.mjs";

const cwd = process.cwd();

function runNodeScript(relativePath, label) {
  const scriptPath = path.resolve(cwd, relativePath);
  console.log(`\n=== ${label} ===`);

  runProcessWithDatabaseRetry({
    command: process.execPath,
    args: [scriptPath],
    cwd,
    env: process.env,
    label,
  });
}

console.log("Kiểm tra migration order variant...");
runNodeScript("scripts/db/migrate-catalog.mjs", "Catalog migrations");
runNodeScript("scripts/db/verify-catalog-migration.mjs", "Catalog DB verification");
await import("./ensure-local-catalog.mjs");
