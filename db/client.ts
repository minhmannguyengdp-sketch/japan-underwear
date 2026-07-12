import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

let pool: Pool | undefined;

function readPoolMax() {
  const rawValue = process.env.DB_POOL_MAX ?? "5";
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`DB_POOL_MAX không hợp lệ: ${rawValue}`);
  }

  return value;
}

export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Thiếu DATABASE_URL. Cấu hình PostgreSQL trước khi gọi database.");
  }

  pool = new Pool({
    connectionString,
    max: readPoolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
  });

  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
