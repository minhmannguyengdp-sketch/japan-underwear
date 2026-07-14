import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
const require = createRequire(import.meta.url);
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const ORDER_PROCESSING_MIGRATION_CREATED_AT = 1783890000000;

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

function isLocalDatabase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
  }
}

function readRepositoryMigrationTimes() {
  const journalPath = path.resolve(cwd, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Drizzle journal không có migration tại ${journalPath}.`);
  }

  return journal.entries
    .map((entry) => Number(entry.when))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => left - right);
}

async function withMigrationJournal(callback) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  const client = new Client({
    connectionString,
    ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });

  try {
    await client.connect();
    const tableResult = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
    );
    if (!tableResult.rows[0]?.table_name) {
      throw new Error("drizzle.__drizzle_migrations does not exist.");
    }
    return await callback(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function isMigrationApplied(createdAt) {
  return withMigrationJournal(async (client) => {
    const result = await client.query(
      "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1",
      [createdAt],
    );
    return result.rowCount === 1;
  });
}

async function readPendingMigrations() {
  return withMigrationJournal(async (client) => {
    const appliedResult = await client.query(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    const applied = new Set(
      appliedResult.rows.map((row) => Number(row.created_at)).filter(Number.isSafeInteger),
    );
    const repository = readRepositoryMigrationTimes();
    return repository.filter((createdAt) => !applied.has(createdAt));
  });
}

// Reconcile migrations with state-aware, transactional runners before asking
// Drizzle to evaluate any future migration that does not yet have a runner.
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-order-variant-identity.mjs")],
  "Order variant identity migration",
);
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-server-cart-orders.mjs")],
  "Server cart and orders migration",
);

if (await isMigrationApplied(ORDER_PROCESSING_MIGRATION_CREATED_AT)) {
  console.log("\n=== Order status lifecycle migration ===");
  console.log("Migration 0010 đã active; bỏ qua runner 0005 để không hạ lifecycle về trạng thái cũ.");
} else {
  run(
    process.execPath,
    [path.resolve(cwd, "scripts", "db", "apply-order-status-lifecycle.mjs")],
    "Order status lifecycle migration",
  );
}

run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-checkout-geolocation.mjs")],
  "Checkout geolocation migration",
);
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-auth-foundation.mjs")],
  "Auth foundation migration",
);
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-customer-order-ownership.mjs")],
  "Customer order ownership migration",
);
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-phase6-checkout-onboarding.mjs")],
  "Phase 6 checkout and onboarding migration",
);
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-order-processing-lifecycle.mjs")],
  "Order processing lifecycle migration",
);

let pending = await readPendingMigrations();
if (pending.length === 0) {
  console.log("\n=== Drizzle migrations ===");
  console.log("Không có migration Drizzle còn thiếu; bỏ qua CLI.");
} else {
  console.log(`\nMigration Drizzle còn thiếu trước khi chạy: ${pending.join(", ")}`);
  run(process.execPath, [resolveDrizzleCli(), "migrate"], "Drizzle migrations");
  pending = await readPendingMigrations();
  if (pending.length > 0) {
    throw new Error(`Drizzle chạy xong nhưng vẫn thiếu migration: ${pending.join(", ")}.`);
  }
}

console.log("\nCatalog migrations completed.");
