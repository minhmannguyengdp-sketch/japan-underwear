import { getPool } from "@/db/client";
import type {
  StaffOrderDetail,
  StaffOrderItem,
  StaffOrderStatus,
  StaffOrderStatusEvent,
  StaffOrderSummary,
  StaffOrderTransition,
} from "@/lib/staff-order-types";

const ORDER_CODE_PATTERN = /^TT-\d{8}-[0-9A-F]{8}$/;
const STAFF_ORDER_LIMIT = 100;

type DatabaseRow = Record<string, unknown>;

export class StaffOrderError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
    public readonly code: string,
  ) {
    super(message);
    this.name = "StaffOrderError";
  }
}

export function isStaffOrderStatus(value: string): value is StaffOrderStatus {
  return (
    value === "submitted" ||
    value === "confirmed" ||
    value === "processing" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function normalizeOrderCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!ORDER_CODE_PATTERN.test(normalized)) {
    throw new StaffOrderError("Mã đơn hàng không hợp lệ.", 400, "invalid_order_code");
  }
  return normalized;
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

function mapOrderSummary(row: DatabaseRow): StaffOrderSummary {
  const status = String(row.status);
  if (!isStaffOrderStatus(status)) {
    throw new Error(`Database returned an unsupported order status: ${status}.`);
  }

  return {
    id: String(row.id),
    orderCode: String(row.order_code),
    status,
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    deliveryAddress:
      row.delivery_address == null ? null : String(row.delivery_address),
    subtotal: Number(row.subtotal),
    currency: String(row.currency),
    itemQuantity: Number(row.item_quantity),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapOrderItem(row: DatabaseRow): StaffOrderItem {
  return {
    id: String(row.id),
    productVariantId: String(row.product_variant_id),
    colorId: String(row.color_id),
    productCode: String(row.product_code_snapshot),
    productName: String(row.product_name_snapshot),
    colorCode: String(row.color_code_snapshot),
    colorName: String(row.color_name_snapshot),
    sizeCode: String(row.size_code_snapshot),
    cupCode: row.cup_code_snapshot == null ? null : String(row.cup_code_snapshot),
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
  };
}

function mapStatusEvent(row: DatabaseRow): StaffOrderStatusEvent {
  const fromStatus = row.from_status == null ? null : String(row.from_status);
  const toStatus = String(row.to_status);
  if (
    (fromStatus !== null && !isStaffOrderStatus(fromStatus)) ||
    !isStaffOrderStatus(toStatus)
  ) {
    throw new Error("Database returned an unsupported order status event.");
  }

  return {
    id: String(row.id),
    fromStatus,
    toStatus,
    actorSource: String(row.actor_source),
    actorLabel: String(row.actor_label),
    reason: row.reason == null ? null : String(row.reason),
    idempotencyKey:
      row.idempotency_key == null ? null : String(row.idempotency_key),
    createdAt: toIso(row.created_at),
  };
}

function mapTransition(row: DatabaseRow): StaffOrderTransition {
  const previousStatus = String(row.previous_status);
  const currentStatus = String(row.current_status);
  if (!isStaffOrderStatus(previousStatus) || !isStaffOrderStatus(currentStatus)) {
    throw new Error("Database returned an unsupported transition result.");
  }

  return {
    orderId: String(row.order_id),
    orderCode: String(row.order_code),
    previousStatus,
    currentStatus,
    changed: Boolean(row.changed),
    idempotent: Boolean(row.idempotent),
    eventId: row.event_id == null ? null : String(row.event_id),
    changedAt: toNullableIso(row.changed_at),
  };
}

export async function listStaffOrders(
  status: StaffOrderStatus | null,
): Promise<StaffOrderSummary[]> {
  const result = await getPool().query(
    `
      SELECT
        orders.id,
        orders.order_code,
        orders.status,
        orders.customer_name,
        orders.customer_phone,
        orders.delivery_address,
        orders.subtotal,
        orders.currency,
        orders.created_at,
        orders.updated_at,
        COALESCE(SUM(order_item.quantity), 0)::int AS item_quantity
      FROM japan_underwear.orders AS orders
      LEFT JOIN japan_underwear.order_items AS order_item
        ON order_item.order_id = orders.id
      WHERE ($1::text IS NULL OR orders.status = $1)
      GROUP BY orders.id
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT $2
    `,
    [status, STAFF_ORDER_LIMIT],
  );

  return (result.rows as DatabaseRow[]).map(mapOrderSummary);
}

export async function getStaffOrder(orderCode: string): Promise<StaffOrderDetail> {
  const normalizedOrderCode = normalizeOrderCode(orderCode);
  const orderResult = await getPool().query(
    `
      SELECT
        orders.id,
        orders.order_code,
        orders.status,
        orders.customer_name,
        orders.customer_phone,
        orders.delivery_address,
        orders.note,
        orders.delivery_latitude,
        orders.delivery_longitude,
        orders.delivery_accuracy_meters,
        orders.location_collected_at,
        orders.location_source,
        orders.subtotal,
        orders.currency,
        orders.created_at,
        orders.updated_at,
        (
          SELECT COALESCE(SUM(order_item.quantity), 0)::int
          FROM japan_underwear.order_items AS order_item
          WHERE order_item.order_id = orders.id
        ) AS item_quantity
      FROM japan_underwear.orders AS orders
      WHERE orders.order_code = $1
      LIMIT 1
    `,
    [normalizedOrderCode],
  );

  if (orderResult.rowCount !== 1) {
    throw new StaffOrderError("Không tìm thấy đơn hàng.", 404, "order_not_found");
  }

  const orderRow = orderResult.rows[0] as DatabaseRow;
  const orderId = String(orderRow.id);
  const [itemResult, historyResult] = await Promise.all([
    getPool().query(
      `
        SELECT
          id,
          product_variant_id,
          color_id,
          quantity,
          unit_price,
          line_total,
          product_code_snapshot,
          product_name_snapshot,
          color_code_snapshot,
          color_name_snapshot,
          size_code_snapshot,
          cup_code_snapshot
        FROM japan_underwear.order_items
        WHERE order_id = $1::uuid
        ORDER BY created_at, id
      `,
      [orderId],
    ),
    getPool().query(
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
        ORDER BY created_at, id
      `,
      [orderId],
    ),
  ]);

  const hasLocation =
    orderRow.delivery_latitude != null &&
    orderRow.delivery_longitude != null &&
    orderRow.delivery_accuracy_meters != null &&
    orderRow.location_collected_at != null &&
    orderRow.location_source === "browser_geolocation";

  return {
    ...mapOrderSummary(orderRow),
    note: orderRow.note == null ? null : String(orderRow.note),
    location: hasLocation
      ? {
          latitude: Number(orderRow.delivery_latitude),
          longitude: Number(orderRow.delivery_longitude),
          accuracyMeters: Number(orderRow.delivery_accuracy_meters),
          collectedAt: toIso(orderRow.location_collected_at),
          source: "browser_geolocation",
        }
      : null,
    items: (itemResult.rows as DatabaseRow[]).map(mapOrderItem),
    history: (historyResult.rows as DatabaseRow[]).map(mapStatusEvent),
  };
}

type TransitionStaffOrderInput = {
  targetStatus: Exclude<StaffOrderStatus, "submitted">;
  actorLabel: string;
  reason?: string | null;
  idempotencyKey: string;
};

function rethrowTransitionDatabaseError(error: unknown): never {
  const databaseError = error as { code?: unknown };
  const code = typeof databaseError.code === "string" ? databaseError.code : "";

  if (code === "P0002") {
    throw new StaffOrderError("Không tìm thấy đơn hàng.", 404, "order_not_found");
  }
  if (code === "22023") {
    throw new StaffOrderError(
      "Yêu cầu chuyển trạng thái không hợp lệ.",
      400,
      "invalid_transition_request",
    );
  }
  if (code === "23505") {
    throw new StaffOrderError(
      "Idempotency key đã được dùng cho một thao tác khác.",
      409,
      "idempotency_conflict",
    );
  }
  if (code === "23514") {
    throw new StaffOrderError(
      "Trạng thái hiện tại của đơn không cho phép thao tác này.",
      409,
      "invalid_status_transition",
    );
  }
  if (code === "40001") {
    throw new StaffOrderError(
      "Đơn vừa được xử lý bởi thao tác khác. Vui lòng tải lại.",
      409,
      "concurrent_status_transition",
    );
  }

  throw error;
}

export async function transitionStaffOrder(
  orderCode: string,
  input: TransitionStaffOrderInput,
) {
  const normalizedOrderCode = normalizeOrderCode(orderCode);
  const actorLabel = input.actorLabel.trim();
  const reason = input.reason?.trim() || null;
  const idempotencyKey = input.idempotencyKey.trim();

  if (!actorLabel || actorLabel.length > 120) {
    throw new StaffOrderError(
      "Không xác định được người thao tác.",
      400,
      "invalid_actor",
    );
  }
  if (input.targetStatus === "cancelled" && !reason) {
    throw new StaffOrderError(
      "Hủy đơn bắt buộc có lý do.",
      400,
      "cancellation_reason_required",
    );
  }
  if (reason && reason.length > 1000) {
    throw new StaffOrderError(
      "Lý do không được vượt quá 1000 ký tự.",
      400,
      "reason_too_long",
    );
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    throw new StaffOrderError(
      "Idempotency key không hợp lệ.",
      400,
      "invalid_idempotency_key",
    );
  }

  let transition: StaffOrderTransition;
  try {
    const result = await getPool().query(
      `
        SELECT *
        FROM japan_underwear.transition_order_status(
          $1,
          $2,
          'staff_web',
          $3,
          $4,
          $5
        )
      `,
      [
        normalizedOrderCode,
        input.targetStatus,
        actorLabel,
        reason,
        idempotencyKey,
      ],
    );
    transition = mapTransition(result.rows[0] as DatabaseRow);
  } catch (error) {
    rethrowTransitionDatabaseError(error);
  }

  return {
    transition,
    order: await getStaffOrder(normalizedOrderCode),
  };
}
