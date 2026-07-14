import { getPool } from "@/db/client";
import type {
  AdminCustomerAuditEvent,
  AdminCustomerDetail,
  AdminCustomerOrderStatus,
  AdminCustomerOrderSummary,
  AdminCustomerRole,
  AdminCustomerStatus,
  AdminCustomerStatusChange,
  AdminCustomerSummary,
} from "@/lib/admin-customer-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_LIMIT = 100;
const DETAIL_ORDER_LIMIT = 50;
const DETAIL_AUDIT_LIMIT = 50;

type DatabaseRow = Record<string, unknown>;

export class AdminCustomerError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AdminCustomerError";
  }
}

function toIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Database returned an invalid timestamp.");
  }
  return date.toISOString();
}

function toNullableIso(value: unknown) {
  return value == null ? null : toIso(value);
}

function parseStatus(value: unknown): AdminCustomerStatus {
  if (value === "active" || value === "blocked") return value;
  throw new Error(`Database returned an unsupported customer status: ${String(value)}.`);
}

function parseOrderStatus(value: unknown): AdminCustomerOrderStatus {
  if (
    value === "submitted" ||
    value === "confirmed" ||
    value === "processing" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Database returned an unsupported order status: ${String(value)}.`);
}

function parseRoles(value: unknown): AdminCustomerRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (role): role is AdminCustomerRole =>
      role === "customer" || role === "sales" || role === "admin",
  );
}

function mapSummary(row: DatabaseRow): AdminCustomerSummary {
  return {
    userId: String(row.user_id),
    email: row.email == null ? null : String(row.email),
    name: row.name == null ? null : String(row.name),
    status: parseStatus(row.status),
    roles: parseRoles(row.roles),
    storeName: row.store_name == null ? null : String(row.store_name),
    contactName: row.contact_name == null ? null : String(row.contact_name),
    phone: row.phone == null ? null : String(row.phone),
    deliveryAddress:
      row.delivery_address == null ? null : String(row.delivery_address),
    profileCompleted: Boolean(row.profile_completed),
    sessionCount: Number(row.session_count ?? 0),
    orderCount: Number(row.order_count ?? 0),
    lifetimeValue: Number(row.lifetime_value ?? 0),
    lastOrderAt: toNullableIso(row.last_order_at),
    lastLoginAt: toNullableIso(row.last_login_at),
    createdAt: toIso(row.created_at),
  };
}

function mapOrder(row: DatabaseRow): AdminCustomerOrderSummary {
  return {
    orderCode: String(row.order_code),
    status: parseOrderStatus(row.status),
    subtotal: Number(row.subtotal),
    currency: String(row.currency),
    itemQuantity: Number(row.item_quantity ?? 0),
    createdAt: toIso(row.created_at),
  };
}

function mapAuditEvent(row: DatabaseRow): AdminCustomerAuditEvent {
  const details = row.details;
  return {
    id: String(row.id),
    actor: String(row.actor),
    action: String(row.action),
    details:
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {},
    createdAt: toIso(row.created_at),
  };
}

function normalizeUserId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AdminCustomerError(
      "Mã khách hàng không hợp lệ.",
      400,
      "invalid_customer_user_id",
    );
  }
  return normalized;
}

const CUSTOMER_READ_MODEL_CTES = `
  WITH role_stats AS (
    SELECT
      user_id,
      array_agg(role ORDER BY role) AS roles
    FROM japan_underwear.user_roles
    GROUP BY user_id
  ),
  session_stats AS (
    SELECT user_id, count(*)::integer AS session_count
    FROM japan_underwear.auth_sessions
    GROUP BY user_id
  ),
  order_stats AS (
    SELECT
      customer_user_id AS user_id,
      count(*)::integer AS order_count,
      COALESCE(sum(subtotal), 0)::bigint AS lifetime_value,
      max(created_at) AS last_order_at
    FROM japan_underwear.orders
    WHERE customer_user_id IS NOT NULL
    GROUP BY customer_user_id
  )
`;

const CUSTOMER_READ_MODEL_SELECT = `
  SELECT
    auth_user.id AS user_id,
    auth_user.email,
    auth_user.name,
    auth_user.status,
    auth_user.last_login_at,
    auth_user.created_at,
    role_stats.roles,
    profile.store_name,
    profile.contact_name,
    profile.phone,
    profile.delivery_address,
    (profile.user_id IS NOT NULL) AS profile_completed,
    COALESCE(session_stats.session_count, 0)::integer AS session_count,
    COALESCE(order_stats.order_count, 0)::integer AS order_count,
    COALESCE(order_stats.lifetime_value, 0)::bigint AS lifetime_value,
    order_stats.last_order_at
  FROM japan_underwear.users AS auth_user
  JOIN role_stats ON role_stats.user_id = auth_user.id
  LEFT JOIN japan_underwear.customer_profiles AS profile
    ON profile.user_id = auth_user.id
  LEFT JOIN session_stats ON session_stats.user_id = auth_user.id
  LEFT JOIN order_stats ON order_stats.user_id = auth_user.id
`;

export async function listAdminCustomers(
  search: string | null,
): Promise<AdminCustomerSummary[]> {
  const normalizedSearch = search?.trim() ?? "";
  if (normalizedSearch.length > 160) {
    throw new AdminCustomerError(
      "Từ khóa tìm kiếm quá dài.",
      400,
      "customer_search_too_long",
    );
  }

  const result = await getPool().query(
    `
      ${CUSTOMER_READ_MODEL_CTES}
      ${CUSTOMER_READ_MODEL_SELECT}
      WHERE 'customer' = ANY(role_stats.roles)
        AND (
          $1 = ''
          OR concat_ws(
            ' ',
            auth_user.email,
            auth_user.name,
            profile.store_name,
            profile.contact_name,
            profile.phone,
            profile.delivery_address
          ) ILIKE '%' || $1 || '%'
        )
      ORDER BY
        COALESCE(order_stats.last_order_at, auth_user.last_login_at, auth_user.created_at) DESC,
        auth_user.id DESC
      LIMIT $2
    `,
    [normalizedSearch, CUSTOMER_LIMIT],
  );

  return (result.rows as DatabaseRow[]).map(mapSummary);
}

export async function getAdminCustomer(userId: string): Promise<AdminCustomerDetail> {
  const normalizedUserId = normalizeUserId(userId);
  const summaryResult = await getPool().query(
    `
      ${CUSTOMER_READ_MODEL_CTES}
      ${CUSTOMER_READ_MODEL_SELECT}
      WHERE auth_user.id = $1::uuid
        AND 'customer' = ANY(role_stats.roles)
      LIMIT 1
    `,
    [normalizedUserId],
  );

  if (summaryResult.rowCount !== 1) {
    throw new AdminCustomerError(
      "Không tìm thấy khách hàng.",
      404,
      "customer_not_found",
    );
  }

  const [orderResult, auditResult] = await Promise.all([
    getPool().query(
      `
        SELECT
          orders.order_code,
          orders.status,
          orders.subtotal,
          orders.currency,
          orders.created_at,
          COALESCE(sum(order_item.quantity), 0)::integer AS item_quantity
        FROM japan_underwear.orders AS orders
        LEFT JOIN japan_underwear.order_items AS order_item
          ON order_item.order_id = orders.id
        WHERE orders.customer_user_id = $1::uuid
        GROUP BY orders.id
        ORDER BY orders.created_at DESC, orders.id DESC
        LIMIT $2
      `,
      [normalizedUserId, DETAIL_ORDER_LIMIT],
    ),
    getPool().query(
      `
        SELECT id, actor, action, details, created_at
        FROM japan_underwear.auth_audit_events
        WHERE target_user_id = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [normalizedUserId, DETAIL_AUDIT_LIMIT],
    ),
  ]);

  return {
    ...mapSummary(summaryResult.rows[0] as DatabaseRow),
    orders: (orderResult.rows as DatabaseRow[]).map(mapOrder),
    auditEvents: (auditResult.rows as DatabaseRow[]).map(mapAuditEvent),
  };
}

type SetAdminCustomerStatusInput = {
  targetStatus: AdminCustomerStatus;
  actorUserId: string;
  actorLabel: string;
};

export async function setAdminCustomerStatus(
  userId: string,
  input: SetAdminCustomerStatusInput,
): Promise<AdminCustomerStatusChange> {
  const targetUserId = normalizeUserId(userId);
  const actorUserId = normalizeUserId(input.actorUserId);
  const actorLabel = input.actorLabel.trim();
  if (!actorLabel || actorLabel.length > 160) {
    throw new AdminCustomerError(
      "Không xác định được người thao tác.",
      400,
      "invalid_customer_status_actor",
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.auth_actor', $1, true)", [
      `staff_web:${actorLabel}`,
    ]);

    const targetResult = await client.query(
      `
        SELECT
          auth_user.id,
          auth_user.status,
          EXISTS (
            SELECT 1
            FROM japan_underwear.user_roles AS role
            WHERE role.user_id = auth_user.id
              AND role.role = 'admin'
          ) AS is_admin,
          EXISTS (
            SELECT 1
            FROM japan_underwear.user_roles AS role
            WHERE role.user_id = auth_user.id
              AND role.role = 'customer'
          ) AS is_customer,
          (
            SELECT count(*)::integer
            FROM japan_underwear.auth_sessions AS session
            WHERE session.user_id = auth_user.id
          ) AS session_count
        FROM japan_underwear.users AS auth_user
        WHERE auth_user.id = $1::uuid
        FOR UPDATE OF auth_user
      `,
      [targetUserId],
    );

    if (targetResult.rowCount !== 1 || !targetResult.rows[0].is_customer) {
      throw new AdminCustomerError(
        "Không tìm thấy khách hàng.",
        404,
        "customer_not_found",
      );
    }

    const previousStatus = parseStatus(targetResult.rows[0].status);
    if (previousStatus === input.targetStatus) {
      await client.query("COMMIT");
      return {
        userId: targetUserId,
        previousStatus,
        currentStatus: previousStatus,
        changed: false,
        revokedSessions: 0,
      };
    }

    if (input.targetStatus === "blocked" && targetUserId === actorUserId) {
      throw new AdminCustomerError(
        "Không thể tự khóa tài khoản đang thao tác.",
        409,
        "cannot_block_current_admin",
      );
    }

    if (input.targetStatus === "blocked" && targetResult.rows[0].is_admin) {
      const activeAdminResult = await client.query(
        `
          SELECT count(DISTINCT auth_user.id)::integer AS count
          FROM japan_underwear.users AS auth_user
          JOIN japan_underwear.user_roles AS role
            ON role.user_id = auth_user.id
           AND role.role = 'admin'
          WHERE auth_user.status = 'active'
            AND auth_user.id <> $1::uuid
        `,
        [targetUserId],
      );
      if (Number(activeAdminResult.rows[0]?.count ?? 0) < 1) {
        throw new AdminCustomerError(
          "Không thể khóa admin hoạt động cuối cùng.",
          409,
          "cannot_block_last_admin",
        );
      }
    }

    const sessionsBefore = Number(targetResult.rows[0].session_count ?? 0);
    const updateResult = await client.query(
      `
        UPDATE japan_underwear.users
        SET status = $2
        WHERE id = $1::uuid
          AND status IS DISTINCT FROM $2
        RETURNING status
      `,
      [targetUserId, input.targetStatus],
    );
    if (updateResult.rowCount !== 1) {
      throw new AdminCustomerError(
        "Trạng thái khách hàng vừa thay đổi. Vui lòng tải lại.",
        409,
        "concurrent_customer_status_change",
      );
    }

    const sessionAfterResult = await client.query(
      `
        SELECT count(*)::integer AS count
        FROM japan_underwear.auth_sessions
        WHERE user_id = $1::uuid
      `,
      [targetUserId],
    );
    const sessionsAfter = Number(sessionAfterResult.rows[0]?.count ?? 0);

    await client.query("COMMIT");
    return {
      userId: targetUserId,
      previousStatus,
      currentStatus: input.targetStatus,
      changed: true,
      revokedSessions: Math.max(0, sessionsBefore - sessionsAfter),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}