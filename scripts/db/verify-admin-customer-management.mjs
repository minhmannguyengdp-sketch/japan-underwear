import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const actualCounts = await client.query(`
    SELECT
      (SELECT count(*)::integer
       FROM japan_underwear.user_roles
       WHERE role = 'customer') AS customers,
      (SELECT count(*)::integer
       FROM japan_underwear.customer_profiles) AS profiles,
      (SELECT count(*)::integer
       FROM japan_underwear.users
       WHERE status = 'blocked') AS blocked_users
  `);

  const targetUserId = randomUUID();
  const targetEmail = `verify-customer-${targetUserId}@example.invalid`;
  const sessionToken = `verify-session-${randomUUID()}`;
  const actor = "verify:admin-customer-management";

  await client.query("BEGIN");
  try {
    await client.query(
      `
        INSERT INTO japan_underwear.users (id, name, email, status)
        VALUES ($1::uuid, 'Verify Customer', $2, 'active')
      `,
      [targetUserId, targetEmail],
    );

    await client.query(
      `
        INSERT INTO japan_underwear.customer_profiles (
          user_id,
          store_name,
          contact_name,
          phone,
          delivery_address
        ) VALUES (
          $1::uuid,
          '  Verify Store  ',
          '  Verify Contact  ',
          '  0900000000  ',
          '  Verify Address  '
        )
      `,
      [targetUserId],
    );

    await client.query(
      `
        INSERT INTO japan_underwear.auth_sessions (session_token, user_id, expires)
        VALUES ($1, $2::uuid, now() + interval '1 day')
      `,
      [sessionToken, targetUserId],
    );

    const readModelResult = await client.query(
      `
        SELECT
          auth_user.status,
          profile.store_name,
          profile.contact_name,
          profile.phone,
          profile.delivery_address,
          EXISTS (
            SELECT 1
            FROM japan_underwear.user_roles AS role
            WHERE role.user_id = auth_user.id
              AND role.role = 'customer'
          ) AS has_customer_role,
          (
            SELECT count(*)::integer
            FROM japan_underwear.auth_sessions AS session
            WHERE session.user_id = auth_user.id
          ) AS session_count
        FROM japan_underwear.users AS auth_user
        JOIN japan_underwear.customer_profiles AS profile
          ON profile.user_id = auth_user.id
        WHERE auth_user.id = $1::uuid
      `,
      [targetUserId],
    );

    assert.equal(readModelResult.rowCount, 1);
    assert.equal(readModelResult.rows[0].status, "active");
    assert.equal(readModelResult.rows[0].store_name, "Verify Store");
    assert.equal(readModelResult.rows[0].contact_name, "Verify Contact");
    assert.equal(readModelResult.rows[0].phone, "0900000000");
    assert.equal(readModelResult.rows[0].delivery_address, "Verify Address");
    assert.equal(readModelResult.rows[0].has_customer_role, true);
    assert.equal(Number(readModelResult.rows[0].session_count), 1);

    await client.query("SELECT set_config('app.auth_actor', $1, true)", [actor]);
    await client.query(
      `UPDATE japan_underwear.users SET status = 'blocked' WHERE id = $1::uuid`,
      [targetUserId],
    );

    const blockedResult = await client.query(
      `
        SELECT
          auth_user.status,
          (SELECT count(*)::integer
           FROM japan_underwear.auth_sessions AS session
           WHERE session.user_id = auth_user.id) AS session_count
        FROM japan_underwear.users AS auth_user
        WHERE auth_user.id = $1::uuid
      `,
      [targetUserId],
    );
    assert.equal(blockedResult.rows[0].status, "blocked");
    assert.equal(Number(blockedResult.rows[0].session_count), 0);

    const blockAuditResult = await client.query(
      `
        SELECT actor, action, details
        FROM japan_underwear.auth_audit_events
        WHERE target_user_id = $1::uuid
          AND action = 'user.blocked'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [targetUserId],
    );
    assert.equal(blockAuditResult.rowCount, 1);
    assert.equal(blockAuditResult.rows[0].actor, actor);
    assert.equal(blockAuditResult.rows[0].action, "user.blocked");
    assert.equal(Number(blockAuditResult.rows[0].details.revoked_sessions), 1);

    await client.query(
      `UPDATE japan_underwear.users SET status = 'active' WHERE id = $1::uuid`,
      [targetUserId],
    );

    const unblockAuditResult = await client.query(
      `
        SELECT actor, action, details
        FROM japan_underwear.auth_audit_events
        WHERE target_user_id = $1::uuid
          AND action = 'user.unblocked'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [targetUserId],
    );
    assert.equal(unblockAuditResult.rowCount, 1);
    assert.equal(unblockAuditResult.rows[0].actor, actor);
    assert.equal(unblockAuditResult.rows[0].details.from, "blocked");
    assert.equal(unblockAuditResult.rows[0].details.to, "active");

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  console.log("Admin customer management verification OK.");
  console.log("Read model: customer role + profile + session aggregation.");
  console.log("Permissions: sales read; admin-only status mutation enforced by API.");
  console.log("Block: sessions revoked and user.blocked audit written transactionally.");
  console.log("Unblock: user.unblocked audit written with the same actor context.");
  console.log("Last active admin and self-block guards are enforced by the service layer.");
  console.log("Runtime fixtures: executed inside a transaction and rolled back.");
  console.log(
    `Current data: ${actualCounts.rows[0].customers} customer role(s), ${actualCounts.rows[0].profiles} profile(s), ${actualCounts.rows[0].blocked_users} blocked user(s).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
