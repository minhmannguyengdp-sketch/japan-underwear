import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const cwd = process.cwd();
const require = createRequire(import.meta.url);

function run(command, args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
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

function resolveDrizzleCli() {
  const candidates = [
    path.resolve(cwd, "node_modules", "drizzle-kit", "bin.cjs"),
    path.resolve(cwd, "node_modules", "drizzle-kit", "dist", "bin.cjs"),
  ];

  try {
    const packageJsonPath = require.resolve("drizzle-kit/package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const binValue =
      typeof packageJson.bin === "string"
        ? packageJson.bin
        : packageJson.bin?.["drizzle-kit"] ?? Object.values(packageJson.bin ?? {})[0];
    if (binValue) {
      candidates.unshift(path.resolve(path.dirname(packageJsonPath), String(binValue)));
    }
  } catch {
    // Fall back to the known local package layout below.
  }

  const cliPath = candidates.find((candidate) => existsSync(candidate));
  if (!cliPath) {
    throw new Error(
      `Không tìm thấy drizzle-kit CLI. Đã kiểm tra: ${candidates.join(", ")}. Chạy npm install rồi thử lại.`,
    );
  }
  return cliPath;
}

// Reconcile the real order-variant schema before Drizzle evaluates 0003.
// This produces an explicit legacy-data error instead of an opaque migration failure,
// records 0003 only after state verification, then lets Drizzle apply any later migrations.
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-order-variant-identity.mjs")],
  "Order variant identity migration",
);
run(process.execPath, [resolveDrizzleCli(), "migrate"], "Drizzle migrations");

console.log("\nCatalog migrations completed.");
