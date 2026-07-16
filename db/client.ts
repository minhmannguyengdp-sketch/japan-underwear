import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

let pool: Pool | undefined;

function readIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const rawValue = process.env[name] ?? String(fallback);
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} không hợp lệ: ${rawValue}`);
  }

  return value;
}

function readPoolMax() {
  return readIntegerEnv("DB_POOL_MAX", 5, 1, 20);
}

function readConnectionTimeoutMillis() {
  return readIntegerEnv("DB_CONNECTION_TIMEOUT_MS", 30_000, 5_000, 120_000);
}

function isLocalDatabase(connectionString: string) {
  try {
    const url = new URL(connectionString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connectionString);
  }
}

export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("Thiếu DATABASE_URL. Cấu hình PostgreSQL trước khi gọi database.");
  }

  pool = new Pool({
    connectionString,
    max: readPoolMax(),
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: readConnectionTimeoutMillis(),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: isLocalDatabase(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
  });

  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
