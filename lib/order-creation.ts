import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { getPool } from "@/db/client";
import type { CheckoutLocationInput, CreatedOrder } from "@/lib/order-types";
import { OrderingError } from "@/lib/server-ordering";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^[0-9+().\s-]+$/;
const MAX_SELECTION_LINES = 200;
const MAX_DATABASE_INTEGER = 2_147_483_647;

export type OrderSelectionInput = {
  productVariantId: string;
  colorId: string;
  quantity: number;
};

export type OrderCustomerSnapshot = {
  storeName?: string | null;
  name: string;
  phone: string;
  deliveryAddress?: string | null;
  note?: string | null;
  location?: CheckoutLocationInput | null;
};

export type SharedOrderCreationInput = {
  source: "customer_checkout" | "staff_manual";
  sourceCartId?: string | null;
  customerUserId?: string | null;
  clientRequestId?: string | null;
  manualRequestId?: string | null;
  createdByUserId?: string | null;
  customer: OrderCustomerSnapshot;
  selections: OrderSelectionInput[];
  actorSource: string;
  actorLabel: string;
  auditIdempotencyKey: string;
};

type PricedOrderItem = {
  productVariantId: string;
  colorId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productCode: string;
  productName: string;
  colorCode: string;
  colorName: string;
  sizeCode: string;
  cupCode: string | null;
};

type PricedOrder = {
  items: PricedOrderItem[];
  subtotal: number;
  currency: string;
  itemCount: number;
};

type DatabaseRow = Record<string, unknown>;

export async function withOrderTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function normalizeOrderUuid(value: string, code: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OrderingError("Mã định danh tạo đơn không hợp lệ.", 400, code);
  }
  return normalized;
}

function normalizeOptionalUuid(value: string | null | undefined, code: string) {
  return value == null ? null : normalizeOrderUuid(value, code);
}

function normalizeText(
  value: string | null | undefined,
  options: { label: string; required?: boolean; max: number },
) {
  const normalized = value?.trim() || null;
  if (options.required && !normalized) {
    throw new OrderingError(`${options.label} là bắt buộc.`, 400, "invalid_order_customer");
  }
  if (normalized && normalized.length > options.max) {
    throw new OrderingError(
      `${options.label} không được vượt quá ${options.max} ký tự.`,
      400,
      "invalid_order_customer",
    );
  }
  return normalized;
}

function normalizeCustomerSnapshot(customer: OrderCustomerSnapshot) {
  const storeName = normalizeText(customer.storeName, {
    label: "Tên cửa hàng",
    max: 160,
  });
  const name = normalizeText(customer.name, {
    label: "Tên người nhận",
    required: true,
    max: 160,
  });
  const phone = normalizeText(customer.phone, {
    label: "Số điện thoại",
    required: true,
    max: 24,
  });
  if (!phone || phone.length < 8 || !PHONE_PATTERN.test(phone)) {
    throw new OrderingError(
      "Số điện thoại phải có 8-24 ký tự hợp lệ.",
      400,
      "invalid_order_customer",
    );
  }
  const deliveryAddress = normalizeText(customer.deliveryAddress, {
    label: "Địa chỉ giao hàng",
    max: 1000,
  });
  const note = normalizeText(customer.note, {
    label: "Ghi chú",
    max: 1000,
  });

  return {
    storeName,
    name: name as string,
    phone,
    deliveryAddress,
    note,
    location: customer.location ?? null,
  };
}

function normalizeSelections(selections: OrderSelectionInput[]) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new OrderingError("Đơn hàng phải có ít nhất một sản phẩm.", 400, "empty_order");
  }
  if (selections.length > MAX_SELECTION_LINES) {
    throw new OrderingError(
      `Đơn hàng không được vượt quá ${MAX_SELECTION_LINES} dòng.`,
      400,
      "order_line_limit",
    );
  }

  const consolidated = new Map<string, OrderSelectionInput>();
  for (const selection of selections) {
    const productVariantId = normalizeOrderUuid(
      selection.productVariantId,
      "invalid_product_variant_id",
    );
    const colorId = normalizeOrderUuid(selection.colorId, "invalid_color_id");
    if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
      throw new OrderingError("Số lượng phải là số nguyên dương.", 400, "invalid_quantity");
    }

    const key = `${productVariantId}:${colorId}`;
    const quantity = (consolidated.get(key)?.quantity ?? 0) + selection.quantity;
    if (quantity > 999) {
      throw new OrderingError(
        "Tổng số lượng một dòng không được vượt quá 999.",
        400,
        "quantity_limit",
      );
    }
    consolidated.set(key, { productVariantId, colorId, quantity });
  }

  return [...consolidated.values()];
}

async function priceOrderSelections(
  client: PoolClient,
  selections: OrderSelectionInput[],
): Promise<PricedOrder> {
  const normalized = normalizeSelections(selections);
  const requestPayload = normalized.map((selection) => ({
    product_variant_id: selection.productVariantId,
    color_id: selection.colorId,
    quantity: selection.quantity,
  }));

  const result = await client.query(
    `
      WITH requested AS (
        SELECT
          item.product_variant_id,
          item.color_id,
          item.quantity
        FROM jsonb_to_recordset($1::jsonb) AS item(
          product_variant_id uuid,
          color_id uuid,
          quantity integer
        )
      )
      SELECT
        requested.product_variant_id,
        requested.color_id,
        requested.quantity,
        variant.product_id AS variant_product_id,
        variant.size_code,
        variant.cup_code,
        variant.is_active AS variant_active,
        color.product_id AS color_product_id,
        color.code AS color_code,
        color.name AS color_name,
        color.is_active AS color_active,
        product.model_code,
        product.name AS product_name,
        product.currency,
        product.is_active AS product_active,
        COALESCE(variant.price_override, product.base_price) AS current_unit_price
      FROM requested
      JOIN japan_underwear.product_variants AS variant
        ON variant.id = requested.product_variant_id
      JOIN japan_underwear.product_colors AS color
        ON color.id = requested.color_id
      JOIN japan_underwear.products AS product
        ON product.id = variant.product_id
      ORDER BY product.model_code, variant.size_code, variant.cup_code, color.sort_order
      FOR SHARE OF variant, color, product
    `,
    [JSON.stringify(requestPayload)],
  );

  if (result.rowCount !== normalized.length) {
    throw new OrderingError(
      "Không tìm thấy một hoặc nhiều màu/size đã chọn.",
      404,
      "selection_not_found",
    );
  }

  const items: PricedOrderItem[] = [];
  const currencies = new Set<string>();
  let subtotal = 0;
  let itemCount = 0;

  for (const row of result.rows as DatabaseRow[]) {
    if (String(row.variant_product_id) !== String(row.color_product_id)) {
      throw new OrderingError(
        `Dòng ${String(row.model_code)} có màu và size/cup khác sản phẩm.`,
        409,
        "selection_product_mismatch",
      );
    }
    if (!row.variant_active || !row.color_active || !row.product_active) {
      throw new OrderingError(
        `Sản phẩm ${String(row.model_code)} có lựa chọn đã ngừng bán.`,
        409,
        "selection_inactive",
      );
    }

    const quantity = Number(row.quantity);
    const unitPrice = Number(row.current_unit_price);
    const lineTotal = unitPrice * quantity;
    if (
      !Number.isInteger(unitPrice) ||
      unitPrice < 0 ||
      unitPrice > MAX_DATABASE_INTEGER ||
      !Number.isSafeInteger(lineTotal) ||
      lineTotal > MAX_DATABASE_INTEGER
    ) {
      throw new OrderingError("Giá sản phẩm vượt giới hạn lưu trữ.", 409, "price_overflow");
    }

    const currency = String(row.currency);
    currencies.add(currency);
    subtotal += lineTotal;
    itemCount += quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal > MAX_DATABASE_INTEGER) {
      throw new OrderingError("Tổng tiền đơn hàng vượt giới hạn lưu trữ.", 409, "subtotal_overflow");
    }

    items.push({
      productVariantId: String(row.product_variant_id),
      colorId: String(row.color_id),
      quantity,
      unitPrice,
      lineTotal,
      productCode: String(row.model_code),
      productName: String(row.product_name),
      colorCode: String(row.color_code),
      colorName: String(row.color_name),
      sizeCode: String(row.size_code),
      cupCode: row.cup_code == null ? null : String(row.cup_code),
    });
  }

  if (currencies.size !== 1) {
    throw new OrderingError(
      "Đơn hàng phải dùng đúng một loại tiền tệ.",
      409,
      "mixed_currency",
    );
  }

  return {
    items,
    subtotal,
    currency: [...currencies][0],
    itemCount,
  };
}

function makeOrderCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TT-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createOrderFromSelections(
  client: PoolClient,
  input: SharedOrderCreationInput,
): Promise<CreatedOrder> {
  const sourceCartId = normalizeOptionalUuid(input.sourceCartId, "invalid_source_cart_id");
  const customerUserId = normalizeOptionalUuid(
    input.customerUserId,
    "invalid_customer_user_id",
  );
  const clientRequestId = normalizeOptionalUuid(
    input.clientRequestId,
    "invalid_client_request_id",
  );
  const manualRequestId = normalizeOptionalUuid(
    input.manualRequestId,
    "invalid_manual_request_id",
  );
  const createdByUserId = normalizeOptionalUuid(
    input.createdByUserId,
    "invalid_created_by_user_id",
  );

  if (
    input.source === "customer_checkout" &&
    (!sourceCartId || !customerUserId || !clientRequestId || manualRequestId || createdByUserId)
  ) {
    throw new OrderingError(
      "Danh tính tạo đơn checkout không hợp lệ.",
      400,
      "invalid_checkout_creation_identity",
    );
  }
  if (
    input.source === "staff_manual" &&
    (sourceCartId || clientRequestId || !manualRequestId || !createdByUserId)
  ) {
    throw new OrderingError(
      "Danh tính tạo đơn tay không hợp lệ.",
      400,
      "invalid_manual_creation_identity",
    );
  }

  const actorSource = input.actorSource.trim();
  const actorLabel = input.actorLabel.trim();
  const auditIdempotencyKey = input.auditIdempotencyKey.trim();
  if (!actorSource || actorSource.length > 80 || !actorLabel || actorLabel.length > 120) {
    throw new OrderingError("Không xác định được người tạo đơn.", 400, "invalid_order_actor");
  }
  if (!auditIdempotencyKey || auditIdempotencyKey.length > 160) {
    throw new OrderingError(
      "Idempotency key tạo đơn không hợp lệ.",
      400,
      "invalid_order_idempotency_key",
    );
  }

  const customer = normalizeCustomerSnapshot(input.customer);
  const priced = await priceOrderSelections(client, input.selections);
  const orderCode = makeOrderCode();

  await client.query(
    `
      SELECT
        set_config('japan_underwear.order_status_actor_source', $1, true),
        set_config('japan_underwear.order_status_actor_label', $2, true),
        set_config('japan_underwear.order_status_idempotency_key', $3, true)
    `,
    [actorSource, actorLabel, auditIdempotencyKey],
  );

  const orderResult = await client.query(
    `
      INSERT INTO japan_underwear.orders (
        order_code,
        order_source,
        source_cart_id,
        manual_request_id,
        created_by_user_id,
        status,
        customer_store_name,
        customer_name,
        customer_phone,
        delivery_address,
        note,
        delivery_latitude,
        delivery_longitude,
        delivery_accuracy_meters,
        location_collected_at,
        location_source,
        subtotal,
        currency,
        customer_user_id,
        client_request_id
      ) VALUES (
        $1,
        $2,
        $3::uuid,
        $4::uuid,
        $5::uuid,
        'submitted',
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::timestamptz,
        $15,
        $16,
        $17,
        $18::uuid,
        $19::uuid
      )
      RETURNING id, created_at
    `,
    [
      orderCode,
      input.source,
      sourceCartId,
      manualRequestId,
      createdByUserId,
      customer.storeName,
      customer.name,
      customer.phone,
      customer.deliveryAddress,
      customer.note,
      customer.location?.latitude ?? null,
      customer.location?.longitude ?? null,
      customer.location?.accuracyMeters ?? null,
      customer.location?.collectedAt ?? null,
      customer.location?.source ?? null,
      priced.subtotal,
      priced.currency,
      customerUserId,
      clientRequestId,
    ],
  );
  const orderId = String(orderResult.rows[0].id);
  const createdAt = new Date(orderResult.rows[0].created_at).toISOString();

  const itemPayload = priced.items.map((item) => ({
    product_variant_id: item.productVariantId,
    color_id: item.colorId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
    product_code_snapshot: item.productCode,
    product_name_snapshot: item.productName,
    color_code_snapshot: item.colorCode,
    color_name_snapshot: item.colorName,
    size_code_snapshot: item.sizeCode,
    cup_code_snapshot: item.cupCode,
  }));

  await client.query(
    `
      INSERT INTO japan_underwear.order_items (
        order_id,
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
      )
      SELECT
        $1::uuid,
        item.product_variant_id,
        item.color_id,
        item.quantity,
        item.unit_price,
        item.line_total,
        item.product_code_snapshot,
        item.product_name_snapshot,
        item.color_code_snapshot,
        item.color_name_snapshot,
        item.size_code_snapshot,
        item.cup_code_snapshot
      FROM jsonb_to_recordset($2::jsonb) AS item(
        product_variant_id uuid,
        color_id uuid,
        quantity integer,
        unit_price integer,
        line_total integer,
        product_code_snapshot text,
        product_name_snapshot text,
        color_code_snapshot text,
        color_name_snapshot text,
        size_code_snapshot text,
        cup_code_snapshot text
      )
    `,
    [orderId, JSON.stringify(itemPayload)],
  );

  const outboxPayload = {
    orderId,
    orderCode,
    orderSource: input.source,
    customerUserId,
    clientRequestId,
    manualRequestId,
    createdByUserId,
    subtotal: priced.subtotal,
    currency: priced.currency,
    itemCount: priced.itemCount,
    createdAt,
  };
  await client.query(
    `
      INSERT INTO japan_underwear.outbox_events (
        aggregate_type,
        aggregate_id,
        event_type,
        payload
      ) VALUES ('order', $1::uuid, 'order.submitted', $2::jsonb)
    `,
    [orderId, JSON.stringify(outboxPayload)],
  );

  return {
    id: orderId,
    orderCode,
    status: "submitted",
    subtotal: priced.subtotal,
    currency: priced.currency,
    itemCount: priced.itemCount,
    locationCaptured: Boolean(customer.location),
    idempotentReplay: false,
    createdAt,
  };
}