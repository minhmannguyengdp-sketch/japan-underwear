import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

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

function parseArgs(values) {
  const positionals = [];
  const flags = new Map();
  for (const value of values) {
    if (value.startsWith("--")) {
      const [name, ...rest] = value.slice(2).split("=");
      flags.set(name, rest.length > 0 ? rest.join("=") : true);
    } else {
      positionals.push(value);
    }
  }
  return { positionals, flags };
}

function usage() {
  console.log(`Auth user management\n\nRead:\n  npm run auth:user -- list\n  npm run auth:user -- show user@example.com\n\nWrites are dry-run unless --apply is present:\n  npm run auth:user -- grant user@example.com sales --actor=minh [--apply]\n  npm run auth:user -- revoke user@example.com sales --actor=minh [--apply]\n  npm run auth:user -- block user@example.com --actor=minh [--apply]\n  npm run auth:user -- unblock user@example.com --actor=minh [--apply]\n  npm run auth:user -- revoke-sessions user@example.com --actor=minh [--apply]`);
}

function normalizedEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 320) {
    throw new Error("Email không hợp lệ.");
  }
  return email;
}

function normalizedRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  if (!new Set(["customer", "sales", "admin"]).has(role)) {
    throw new Error("Role phải là customer, sales hoặc admin.");
  }
  return role;
}

const { positionals, flags } = parseArgs(process.argv.slice(2));
const command = positionals[0] ?? "help";
const apply = flags.get("apply") === true;
const actor = typeof flags.get("actor") === "string" ? String(flags.get("actor")).trim() : "";
const writeCommands = new Set(["grant", "revoke", "block", "unblock", "revoke-sessions"]);

if (writeCommands.has(command) && !actor) {
  console.error("Write command bắt buộc có --actor=<tên người thao tác>.");
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
});

async function findUser(email, forUpdate = false) {
  const result = await client.query(
    `
      SELECT auth_user.id,
             auth_user.email,
             auth_user.name,
             auth_user.status,
             auth_user.last_login_at,
             auth_user.created_at,
             ARRAY(
               SELECT role.role
               FROM japan_underwear.user_roles AS role
               WHERE role.user_id = auth_user.id
               ORDER BY role.role
             ) AS roles,
             (
               SELECT count(*)::integer
               FROM japan_underwear.auth_sessions AS session
               WHERE session.user_id = auth_user.id
             ) AS session_count
      FROM japan_underwear.users AS auth_user
      WHERE lower(auth_user.email) = $1
      ${forUpdate ? "FOR UPDATE OF auth_user" : ""}
    `,
    [email],
  );
  if (result.rowCount !== 1) throw new Error(`Không tìm thấy user ${email}.`);
  return result.rows[0];
}

function printUser(user) {
  console.log(`User: ${user.email}`);
  console.log(`ID: ${user.id}`);
  console.log(`Name: ${user.name ?? "(none)"}`);
  console.log(`Status: ${user.status}`);
  console.log(`Roles: ${(user.roles ?? []).join(", ") || "(none)"}`);
  console.log(`Sessions: ${user.session_count}`);
  console.log(`Last login: ${user.last_login_at?.toISOString?.() ?? user.last_login_at ?? "(never)"}`);
  console.log(`Created: ${user.created_at?.toISOString?.() ?? user.created_at}`);
}

async function assertNotLastActiveAdmin(userId) {
  const result = await client.query(
    `
      SELECT count(DISTINCT auth_user.id)::integer AS count
      FROM japan_underwear.users AS auth_user
      JOIN japan_underwear.user_roles AS role
        ON role.user_id = auth_user.id AND role.role = 'admin'
      WHERE auth_user.status = 'active'
        AND auth_user.id <> $1::uuid
    `,
    [userId],
  );
  if (Number(result.rows[0]?.count ?? 0) < 1) {
    throw new Error("Không thể vô hiệu hóa hoặc bỏ role admin của admin hoạt động cuối cùng.");
  }
}

async function listUsers() {
  const result = await client.query(`
    SELECT auth_user.email,
           auth_user.name,
           auth_user.status,
           COALESCE(string_agg(role.role, ',' ORDER BY role.role), '') AS roles,
           count(DISTINCT session.session_token)::integer AS sessions,
           auth_user.last_login_at
    FROM japan_underwear.users AS auth_user
    LEFT JOIN japan_underwear.user_roles AS role ON role.user_id = auth_user.id
    LEFT JOIN japan_underwear.auth_sessions AS session ON session.user_id = auth_user.id
    GROUP BY auth_user.id
    ORDER BY auth_user.created_at DESC
    LIMIT 100
  `);
  console.log("=== Auth users ===");
  if (result.rowCount === 0) {
    console.log("Chưa có user. Đăng nhập Google lần đầu để tạo customer user.");
    return;
  }
  for (const row of result.rows) {
    console.log(
      `${row.email ?? "(no email)"} | ${row.status} | ${row.roles || "(none)"} | ${row.sessions} session(s) | ${row.last_login_at?.toISOString?.() ?? row.last_login_at ?? "never"}`,
    );
  }
}

async function runWrite() {
  const email = normalizedEmail(positionals[1]);
  const role = command === "grant" || command === "revoke" ? normalizedRole(positionals[2]) : null;

  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.auth_actor', $1, true)", [`internal_cli:${actor}`]);
    const user = await findUser(email, true);
    printUser(user);

    if (command === "revoke" && role === "customer") {
      throw new Error("Không revoke role customer nền. Hãy block user nếu cần khóa truy cập.");
    }
    if (command === "revoke" && role === "admin" && user.roles.includes("admin")) {
      await assertNotLastActiveAdmin(user.id);
    }
    if (command === "block" && user.status === "active" && user.roles.includes("admin")) {
      await assertNotLastActiveAdmin(user.id);
    }

    console.log(`\nRequested: ${command}${role ? ` ${role}` : ""}`);
    console.log(`Actor: internal_cli:${actor}`);
    if (!apply) {
      await client.query("ROLLBACK");
      console.log("DRY-RUN: chưa ghi database. Thêm --apply để thực hiện.");
      return;
    }

    let result;
    if (command === "grant") {
      result = await client.query(
        `INSERT INTO japan_underwear.user_roles (user_id, role) VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING RETURNING role`,
        [user.id, role],
      );
    } else if (command === "revoke") {
      result = await client.query(
        `DELETE FROM japan_underwear.user_roles WHERE user_id = $1::uuid AND role = $2 RETURNING role`,
        [user.id, role],
      );
    } else if (command === "block" || command === "unblock") {
      result = await client.query(
        `UPDATE japan_underwear.users SET status = $2 WHERE id = $1::uuid AND status IS DISTINCT FROM $2 RETURNING status`,
        [user.id, command === "block" ? "blocked" : "active"],
      );
    } else if (command === "revoke-sessions") {
      result = await client.query(
        `DELETE FROM japan_underwear.auth_sessions WHERE user_id = $1::uuid RETURNING session_token`,
        [user.id],
      );
      await client.query(
        `INSERT INTO japan_underwear.auth_audit_events (actor, action, target_user_id, details) VALUES ($1, 'sessions.revoked', $2::uuid, jsonb_build_object('count', $3::integer))`,
        [`internal_cli:${actor}`, user.id, result.rowCount],
      );
    }

    await client.query("COMMIT");
    console.log(`Auth user command OK. Changed rows: ${result?.rowCount ?? 0}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  await client.connect();
  try {
    if (command === "help" || command === "--help") {
      usage();
      return;
    }
    if (command === "list") {
      await listUsers();
      return;
    }
    if (command === "show") {
      printUser(await findUser(normalizedEmail(positionals[1])));
      return;
    }
    if (writeCommands.has(command)) {
      await runWrite();
      return;
    }
    usage();
    throw new Error(`Command không hỗ trợ: ${command}.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`Auth user command failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
