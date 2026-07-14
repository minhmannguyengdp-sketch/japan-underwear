import { getPool } from "@/db/client";
import type {
  CustomerOrderDetail,
  CustomerOrderItem,
  CustomerOrderStatus,
  CustomerOrderStatusEvent,
  CustomerOrderSummary,
} from "@/lib/customer-order-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_CODE_PATTERN = /^TT-\d{8}-[0-9A-F]{8}$/;
const CUSTOMER_ORDER_LIMIT = 100;

type DatabaseRow = Record<string, unknown>;

export class CustomerOrderError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CustomerOrderError";
  }
}

function normalizeUserId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerOrderError("Danh tính người dùng không hợp lệ.", 400, "invalid_user_id");
  }
  return normalized;
}

function normalizeOrderCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!ORDER_CODE_PATTERN.test(normalized)) {
    throw new CustomerOrderError("Mã đơn hàng không hợp lệ.", 400, "invalid_order_code");
  }
  return normalized;
}

function isCustomerOrderStatus(value: string): value is CustomerOrderStatus {
  return (
    value === "submitted" ||
    value === "confirmed" ||
    value === "processing" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function toIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Database returned an invalid timestamp.");
  }
  return date.toISOString();
}

function mapSummary(row: DatabaseRow): CustomerOrderSummary {
  const status = String(row.status);
  if (!isCustomerOrderStatus(status)) {
    throw new Error(`Database returned an unsupported order status: ${status}.`);
  }

  return {
    orderCode: String(row.order_code),
    status,
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    deliveryAddress: row.delivery_address == null ? null : String(row.delivery_address),
    subtotal: Number(row.subtotal),
    currency: String(row.currency),
    itemQuantity: Number(row.item_quantity),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapItem(row: DatabaseRow): CustomerOrderItem {
  return {
    id: String(row.id),
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

function mapHistory(row: DatabaseRow): CustomerOrderStatusEvent {
  const fromStatus = row.from_status == null ? null : String(row.from_status);
  const toStatus = String(row.to_status);
  if (
    (fromStatus !== null && !isCustomerOrderStatus(fromStatus)) ||
    !isCustomerOrderStatus(toStatus)
  ) {
    throw new Error("Database returned an unsupported order history event.");
  }

  return {
    id: String(row.id),
    fromStatus,
    toStatus,
    reason: row.reason == null ? null : String(row.reason),
    createdAt: toIso(row.created_at),
  };
}

export async function listCustomerOrders(userId: string): Promise<CustomerOrderSummary[]> {
  const normalizedUserId = normalizeUserId(userId);
  const result = await getPool().query(
    `
      SELECT
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
      WHERE orders.customer_user_id = $1::uuid
      GROUP BY orders.id
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT $2
    `,
    [normalizedUserId, CUSTOMER_ORDER_LIMIT],
  );

  return (result.rows as DatabaseRow[]).map(mapSummary);
}

export async function getCustomerOrder(
  userId: string,
  orderCode: string,
): Promise<CustomerOrderDetail> {
  const normalizedUserId = normalizeUserId(userId);
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
        AND orders.customer_user_id = $2::uuid
      LIMIT 1
    `,
    [normalizedOrderCode, normalizedUserId],
  );

  if (orderResult.rowCount !== 1) {
    throw new CustomerOrderError("Không tìm thấy đơn hàng.", 404, "order_not_found");
  }

  const orderRow = orderResult.rows[0] as DatabaseRow;
  const orderId = String(orderRow.id);
  const [itemResult, historyResult] = await Promise.all([
    getPool().query(
      `
        SELECT
          id,
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
        SELECT id, from_status, to_status, reason, created_at
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
    ...mapSummary(orderRow),
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
    items: (itemResult.rows as DatabaseRow[]).map(mapItem),
    history: (historyResult.rows as DatabaseRow[]).map(mapHistory),
  };
}
