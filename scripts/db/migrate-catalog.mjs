import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
const require = createRequire(import.meta.url);
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const JOURNAL_MAX_ATTEMPTS = 4;
const REPAIR_MIGRATIONS = [
  {
    createdAt: 1783853000000,
    filename: "apply-order-variant-identity.mjs",
    label: "Order variant identity migration",
  },
  {
    createdAt: 1783860000000,
    filename: "apply-server-cart-orders.mjs",
    label: "Server cart and orders migration",
  },
  {
    createdAt: 1783865000000,
    filename: "apply-order-status-lifecycle.mjs",
    label: "Order status lifecycle migration",
    supersededBy: 1783890000000,
  },
  {
    createdAt: 1783870000000,
    filename: "apply-checkout-geolocation.mjs",
    label: "Checkout geolocation migration",
  },
  {
    createdAt: 1783875000000,
    filename: "apply-auth-foundation.mjs",
    label: "Auth foundation migration",
  },
  {
    createdAt: 1783880000000,
    filename: "apply-customer-order-ownership.mjs",
    label: "Customer order ownership migration",
  },
  {
    createdAt: 1783885000000,
    filename: "apply-phase6-checkout-onboarding.mjs",
    label: "Phase 6 checkout and onboarding migration",
  },
  {
    createdAt: 1783890000000,
    filename: "apply-order-processing-lifecycle.mjs",
    label: "Order processing lifecycle migration",
  },
  {
    createdAt: 1783895000000,
    filename: "apply-manual-order-shared-service.mjs",
    label: "Manual order shared service migration",
  },
  {
    createdAt: 1783900000000,
    filename: "apply-catalog-price-management.mjs",
    label: "Catalog price management migration",
  },
  {
    createdAt: 1783905000000,
    filename: "apply-color-variant-availability.mjs",
    label: "Color–size/cup availability migration",
  },
];

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
    // Fall back to the known local package layout.
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

function isRetryableConnectionError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "08000", "08001", "08003", "08006", "57P01"].includes(code) ||
    /timeout expired|connection terminated|connection closed|socket hang up/i.test(message)
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  let lastError;
  for (let attempt = 1; attempt <= JOURNAL_MAX_ATTEMPTS; attempt += 1) {
    const client = new Client({
      connectionString,
      ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
      connectionTimeoutMillis: 30_000,
      query_timeout: 120_000,
      keepAlive: true,
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
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || attempt === JOURNAL_MAX_ATTEMPTS) {
        throw error;
      }
      console.warn(
        `Migration journal connection lần ${attempt}/${JOURNAL_MAX_ATTEMPTS} chưa thành công: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(attempt * 2_000);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  throw lastError;
}

async function readAppliedMigrationTimes() {
  return withMigrationJournal(async (client) => {
    const result = await client.query(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    return new Set(
      result.rows.map((row) => Number(row.created_at)).filter(Number.isSafeInteger),
    );
  });
}

async function readPendingMigrations() {
  const applied = await readAppliedMigrationTimes();
  return readRepositoryMigrationTimes().filter((createdAt) => !applied.has(createdAt));
}

function runDbScript(filename, label) {
  run(process.execPath, [path.resolve(cwd, "scripts", "db", filename)], label);
}

const appliedMigrations = await readAppliedMigrationTimes();
for (const migration of REPAIR_MIGRATIONS) {
  if (appliedMigrations.has(migration.createdAt)) {
    console.log(`\n=== ${migration.label} ===`);
    console.log(`Migration ${migration.createdAt} đã có trong journal; bỏ qua repair runner.`);
    continue;
  }
  if (migration.supersededBy && appliedMigrations.has(migration.supersededBy)) {
    console.log(`\n=== ${migration.label} ===`);
    console.log(
      `Migration ${migration.supersededBy} đã thay thế ${migration.createdAt}; bỏ qua runner cũ.`,
    );
    continue;
  }

  runDbScript(migration.filename, migration.label);
  appliedMigrations.add(migration.createdAt);
}

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
