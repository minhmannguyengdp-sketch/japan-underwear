import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const [firstArgument, secondArgument, ...remainingArguments] = process.argv.slice(2);
const listMode = String(firstArgument ?? "").trim().toLowerCase() === "list";
const orderCode = listMode ? "" : String(firstArgument ?? "").trim();
const action = listMode
  ? "list"
  : String(secondArgument ?? "history").trim().toLowerCase();
const optionArguments = listMode
  ? [secondArgument, ...remainingArguments].filter((value) => typeof value === "string")
  : remainingArguments;

function readOption(name) {
  const prefix = `--${name}=`;
  const match = optionArguments.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : null;
}

const apply = optionArguments.includes("--apply");
const actor = readOption("actor");
const reason = readOption("reason");
const requestedKey = readOption("key");
const idempotencyKey = requestedKey || randomUUID();
const listStatus = String(readOption("status") ?? "submitted").trim().toLowerCase();
const listLimit = Number.parseInt(readOption("limit") ?? "20", 10);

function printUsage() {
  console.error(`Usage:
  npm run order:status -- list [--status=submitted|confirmed|cancelled|all] [--limit=20]
  npm run order:status -- <ORDER_CODE> history
  npm run order:status -- <ORDER_CODE> confirmed --actor=<name> [--reason=<text>] [--key=<key>] [--apply]
  npm run order:status -- <ORDER_CODE> cancelled --actor=<name> --reason=<text> [--key=<key>] [--apply]`);
}

if (listMode) {
  if (!["submitted", "confirmed", "cancelled", "all"].includes(listStatus)) {
    console.error("--status phải là submitted, confirmed, cancelled hoặc all.");
    process.exit(1);
  }
  if (!Number.isInteger(listLimit) || listLimit < 1 || listLimit > 100) {
    console.error("--limit phải là số nguyên từ 1 đến 100.");
    process.exit(1);
  }
} else if (!orderCode || !["history", "confirmed", "cancelled"].includes(action)) {
  printUsage();
  process.exit(1);
}

if (!listMode && action !== "history") {
  if (!actor || actor.length < 2 || actor.length > 120) {
    console.error("--actor là bắt buộc và phải dài 2-120 ký tự.");
    process.exit(1);
  }
  if (action === "cancelled" && (!reason || reason.length < 3)) {
    console.error("Hủy đơn bắt buộc có --reason dài ít nhất 3 ký tự.");
    process.exit(1);
  }
  if (reason && reason.length > 1000) {
    console.error("--reason không được vượt quá 1000 ký tự.");
    process.exit(1);
  }
  if (idempotencyKey.length > 160) {
    console.error("--key không được vượt quá 160 ký tự.");
    process.exit(1);
  }
}

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

function formatVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatPgError(error) {
  if (!(error instanceof Error)) return String(error);
  const details = [error.message];
  if (error.code) details.push(`code=${error.code}`);
  if (error.detail) details.push(`detail=${error.detail}`);
  if (error.hint) details.push(`hint=${error.hint}`);
  if (error.constraint) details.push(`constraint=${error.constraint}`);
  return details.join(" | ");
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

async function listOrders() {
  const statusFilter = listStatus === "all" ? null : listStatus;
  const result = await client.query(
    `
      SELECT
        orders.order_code,
        orders.status,
        orders.customer_name,
        orders.subtotal,
        orders.currency,
        orders.created_at,
        count(order_items.id)::integer AS line_count,
        COALESCE(sum(order_items.quantity), 0)::integer AS item_count
      FROM japan_underwear.orders AS orders
      LEFT JOIN japan_underwear.order_items AS order_items
        ON order_items.order_id = orders.id
      WHERE ($1::text IS NULL OR orders.status = $1)
      GROUP BY orders.id
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT $2
    `,
    [statusFilter, listLimit],
  );

  console.log("=== Recent orders ===");
  console.log(`Status filter: ${statusFilter ?? "all"}. Limit: ${listLimit}.`);
  if (result.rowCount === 0) {
    console.log("Không có đơn phù hợp.");
    return;
  }

  for (const order of result.rows) {
    const createdAt = new Date(order.created_at).toISOString();
    const subtotal =
      String(order.currency) === "VND"
        ? formatVnd(order.subtotal)
        : `${order.subtotal} ${order.currency}`;
    console.log(
      `${order.order_code} | ${order.status} | ${order.customer_name} | ` +
        `${order.line_count} dòng/${order.item_count} SP | ${subtotal} | ${createdAt}`,
    );
  }
}

async function loadOrder() {
  const result = await client.query(
    `
      SELECT
        orders.id,
        orders.order_code,
        orders.status,
        orders.subtotal,
        orders.currency,
        orders.created_at,
        orders.updated_at,
        count(order_items.id)::integer AS line_count,
        COALESCE(sum(order_items.quantity), 0)::integer AS item_count
      FROM japan_underwear.orders AS orders
      LEFT JOIN japan_underwear.order_items AS order_items
        ON order_items.order_id = orders.id
      WHERE upper(orders.order_code) = upper($1)
      GROUP BY orders.id
      LIMIT 1
    `,
    [orderCode],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function loadHistory(orderId) {
  const result = await client.query(
    `
      SELECT
        id,
        from_status,
        to_status,
        actor_source,
        actor_label,
        reason,
        idempotency_key,
        created_at
      FROM japan_underwear.order_status_events
      WHERE order_id = $1::uuid
      ORDER BY created_at ASC, id ASC
    `,
    [orderId],
  );
  return result.rows;
}

function printOrder(order) {
  console.log(`Order: ${order.order_code}`);
  console.log(`Status: ${order.status}`);
  console.log(`Lines/items: ${order.line_count}/${order.item_count}`);
  console.log(
    `Subtotal: ${formatVnd(order.subtotal)} ${order.currency === "VND" ? "" : order.currency}`.trim(),
  );
  console.log(`Created: ${new Date(order.created_at).toISOString()}`);
  console.log(`Updated: ${new Date(order.updated_at).toISOString()}`);
}

function printHistory(events) {
  console.log("\nStatus history:");
  if (events.length === 0) {
    console.log("  (empty)");
    return;
  }
  for (const event of events) {
    const transition = `${event.from_status ?? "∅"} -> ${event.to_status}`;
    const reasonText = event.reason ? ` | ${event.reason}` : "";
    console.log(
      `  ${new Date(event.created_at).toISOString()} | ${transition} | ${event.actor_source}:${event.actor_label}${reasonText}`,
    );
  }
}

async function main() {
  await client.connect();

  if (listMode) {
    await listOrders();
    return;
  }

  const current = await loadOrder();
  if (!current) {
    throw new Error(
      `Không tìm thấy đơn ${orderCode}. Chạy "npm run order:status -- list" để lấy mã đơn submitted gần nhất.`,
    );
  }

  printOrder(current);
  const currentHistory = await loadHistory(current.id);
  printHistory(currentHistory);

  if (action === "history") return;

  console.log("\nRequested transition:");
  console.log(`  ${current.status} -> ${action}`);
  console.log(`  actor: internal_cli:${actor}`);
  console.log(`  reason: ${reason || "(none)"}`);
  console.log(`  idempotency key: ${idempotencyKey}`);

  if (!apply) {
    console.log("\nDRY-RUN: chưa ghi database. Thêm --apply để thực hiện.");
    return;
  }

  const transitionResult = await client.query(
    `
      SELECT *
      FROM japan_underwear.transition_order_status(
        $1,
        $2,
        'internal_cli',
        $3,
        $4,
        $5
      )
    `,
    [orderCode, action, actor, reason || null, idempotencyKey],
  );

  const outcome = transitionResult.rows[0];
  console.log("\nOrder status command OK.");
  console.log(`Changed: ${Boolean(outcome.changed)}`);
  console.log(`Idempotent replay: ${Boolean(outcome.idempotent)}`);
  console.log(`Status: ${outcome.previous_status} -> ${outcome.current_status}`);
  console.log(`Event ID: ${outcome.event_id ?? "none"}`);

  const refreshed = await loadOrder();
  if (refreshed) {
    console.log("");
    printOrder(refreshed);
    printHistory(await loadHistory(refreshed.id));
  }
}

main()
  .catch((error) => {
    console.error(`Order status command failed: ${formatPgError(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
