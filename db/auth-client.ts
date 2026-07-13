import { drizzle } from "drizzle-orm/node-postgres";

import { getPool } from "./client";
import * as authSchema from "./auth-schema";

export function getAuthDb() {
  return drizzle(getPool(), { schema: authSchema });
}
