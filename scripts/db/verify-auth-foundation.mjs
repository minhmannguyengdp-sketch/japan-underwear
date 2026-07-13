import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const MIGRATION_CREATED_AT = 1783875000000;
const REQUIRED_TABLES = [
  "users",
  "auth_accounts",
  "auth_sessions",
  "user_roles",
  "auth_audit_events",
];
const REQUIRED_TRIGGERS = [
  "users_normalize_trg",
  "users_default_customer_role_trg",
  "users_status_guard_trg",
  "user_roles_audit_trg",
];

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Thiếu DATABASE_URL trong .env.local hoặc .env.");
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

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  try {
    const tableResult = await client.query(
      `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'japan_underwear'
          AND tablename = ANY($1::text[])
      `,
      [REQUIRED_TABLES],
    );
    const tables = new Set(tableResult.rows.map((row) => String(row.tablename)));
    const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
    if (missingTables.length > 0) {
      throw new Error(`Missing auth tables: ${missingTables.join(", ")}.`);
    }

    const triggerResult = await client.query(
      `
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE trigger_schema = 'japan_underwear'
          AND trigger_name = ANY($1::text[])
      `,
      [REQUIRED_TRIGGERS],
    );
    const triggers = new Set(triggerResult.rows.map((row) => String(row.trigger_name)));
    const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggers.has(name));
    if (missingTriggers.length > 0) {
      throw new Error(`Missing auth triggers: ${missingTriggers.join(", ")}.`);
    }

    const roleConstraintResult = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'japan_underwear.user_roles'::regclass
        AND conname = 'user_roles_role_chk'
    `);
    const roleDefinition = String(roleConstraintResult.rows[0]?.definition ?? "");
    for (const role of ["customer", "sales", "admin"]) {
      if (!roleDefinition.includes(role)) {
        throw new Error(`Role constraint does not contain ${role}.`);
      }
    }

    const statusConstraintResult = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'japan_underwear.users'::regclass
        AND conname = 'users_status_chk'
    `);
    const statusDefinition = String(statusConstraintResult.rows[0]?.definition ?? "");
    if (!statusDefinition.includes("active") || !statusDefinition.includes("blocked")) {
      throw new Error("User status constraint must allow active and blocked only.");
    }

    const orphanRoleResult = await client.query(`
      SELECT count(*)::integer AS count
      FROM japan_underwear.user_roles AS role
      LEFT JOIN japan_underwear.users AS auth_user ON auth_user.id = role.user_id
      WHERE auth_user.id IS NULL
    `);
    if (Number(orphanRoleResult.rows[0]?.count ?? 0) !== 0) {
      throw new Error("Auth role table contains orphan users.");
    }

    const migrationResult = await client.query(
      `SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
      [MIGRATION_CREATED_AT],
    );
    if (Number(migrationResult.rows[0]?.count ?? 0) !== 1) {
      throw new Error(`Migration record ${MIGRATION_CREATED_AT} must exist exactly once.`);
    }

    const countsResult = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM japan_underwear.users) AS users,
        (SELECT count(*)::integer FROM japan_underwear.auth_sessions) AS sessions,
        (SELECT count(*)::integer FROM japan_underwear.user_roles) AS roles,
        (SELECT count(*)::integer FROM japan_underwear.auth_audit_events) AS audit_events
    `);
    const counts = countsResult.rows[0];

    console.log("Auth foundation verification OK.");
    console.log("Provider: Google OAuth via Auth.js.");
    console.log("Identity: internal UUID; provider identity stored in auth_accounts.");
    console.log("Session: PostgreSQL database sessions.");
    console.log("Roles: customer | sales | admin; server authorization required.");
    console.log("Blocked user: database trigger revokes sessions.");
    console.log(
      `Auth records: ${counts.users} user(s), ${counts.sessions} session(s), ${counts.roles} role row(s), ${counts.audit_events} audit event(s).`,
    );
    console.log(`Migration record: ${MIGRATION_CREATED_AT}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
