import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { getPool } from "@/db/client";
import type { CheckoutLocationInput, CreatedOrder } from "@/lib/order-types";
import { OrderingError } from "@/lib/server-ordering";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LOCATION_AGE_MS = 30 * 60 * 1000;
const MAX_LOCATION_FUTURE_MS = 5 * 60 * 1000;

export type CustomerCheckoutInput = {
  clientRequestId: string;
  note?: string | null;
  location?: CheckoutLocationInput | null;
};

type ProfileRow = {
  store_name: string;
  contact_name: string;
  phone: string;
  delivery_address: string;
};

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
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

function normalizeUuid(value: string, code: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OrderingError("Mã yêu cầu checkout không hợp lệ.", 400, code);
  }
  return normalized;
}

function normalizeCheckoutLocation(location: CheckoutLocationInput | null | undefined) {
  if (!location) return null;

  const collectedAt = Date.parse(location.collectedAt);
  const now = Date.now();
  const valid =
    location.source === "browser_geolocation" &&
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180 &&
    Number.isFinite(location.accuracyMeters) &&
    location.accuracyMeters > 0 &&
    location.accuracyMeters <= 100000 &&
    Number.isFinite(collectedAt) &&
    collectedAt >= now - MAX_LOCATION_AGE_MS &&
    collectedAt <= now + MAX_LOCATION_FUTURE_MS;

  if (!valid) {
    throw new OrderingError(
      "Vị trí giao hàng không hợp lệ hoặc đã quá cũ. Vui lòng lấy lại vị trí.",
      400,
      "invalid_checkout_location",
    );
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyMeters: location.accuracyMeters,
    collectedAt: new Date(collectedAt).toISOString(),
    source: location.source,
  };
}

function makeOrderCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TT-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function findExistingOrder(
  client: PoolClient,
  customerUserId: string,
  clientRequestId: string,
): Promise<CreatedOrder | null> {
  const result = await client.query(
    `
      SELECT
        orders.id,
        orders.order_code,
        orders.status,
        orders.subtotal,
        orders.currency,
        orders.created_at,
        orders.delivery_latitude IS NOT NULL AS location_captured,
        COALESCE(sum(order_item.quantity), 0)::integer AS item_count
      FROM japan_underwear.orders AS orders
      LEFT JOIN japan_underwear.order_items AS order_item
        ON order_item.order_id = orders.id
      WHERE orders.customer_user_id = $1::uuid
        AND orders.client_request_id = $2::uuid
      GROUP BY orders.id
      LIMIT 1
    `,
    [customerUserId, clientRequestId],
  );

  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    orderCode: String(row.order_code),
    status: String(row.status) as CreatedOrder["status"],
    subtotal: Number(row.subtotal),
    currency: String(row.currency),
    itemCount: Number(row.item_count),
    locationCaptured: Boolean(row.location_captured),
    idempotentReplay: true,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function loadProfileForCheckout(
  client: PoolClient,
  customerUserId: string,
): Promise<ProfileRow> {
  const result = await client.query(
    `
      SELECT store_name, contact_name, phone, delivery_address
      FROM japan_underwear.customer_profiles
      WHERE user_id = $1::uuid
      LIMIT 1
      FOR SHARE
    `,
    [customerUserId],
  );

  if (result.rowCount !== 1) {
    throw new OrderingError(
      "Vui lòng hoàn tất hồ sơ cửa hàng, người liên hệ, điện thoại và địa chỉ trước khi đặt đơn.",
      409,
      "onboarding_required",
    );
  }

  return result.rows[0] as ProfileRow;
}

export async function createIdempotentCustomerOrder(
  requestedToken: string | null,
  customerUserId: string,
  input: CustomerCheckoutInput,
): Promise<CreatedOrder> {
  const normalizedCustomerUserId = normalizeUuid(customerUserId, "invalid_customer_user_id");
  const normalizedClientRequestId = normalizeUuid(
    input.clientRequestId,
    "invalid_client_request_id",
  );
  const location = normalizeCheckoutLocation(input.location);
  const note = input.note?.trim() || null;

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      normalizedCustomerUserId,
      normalizedClientRequestId,
    ]);

    const replay = await findExistingOrder(
      client,
      normalizedCustomerUserId,
      normalizedClientRequestId,
    );
    if (replay) return replay;

    const profile = await loadProfileForCheckout(client, normalizedCustomerUserId);

    if (!requestedToken || !UUID_PATTERN.test(requestedToken)) {
      throw new OrderingError("Giỏ hàng không tồn tại.", 409, "cart_unavailable");
    }

    const cartResult = await client.query(
      `
        SELECT id, status
        FROM japan_underwear.carts
        WHERE token = $1::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [requestedToken],
    );

    if (cartResult.rowCount !== 1 || cartResult.rows[0].status !== "active") {
      const replayAfterCartLock = await findExistingOrder(
        client,
        normalizedCustomerUserId,
        normalizedClientRequestId,
      );
      if (replayAfterCartLock) return replayAfterCartLock;
      throw new OrderingError(
        "Giỏ hàng không tồn tại hoặc đã được tạo đơn.",
        409,
        "cart_unavailable",
      );
    }

    const cartId = String(cartResult.rows[0].id);
    const itemResult = await client.query(
      `
        SELECT
          cart_item.product_variant_id,
          cart_item.color_id,
          cart_item.quantity,
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
        FROM japan_underwear.cart_items AS cart_item
        JOIN japan_underwear.product_variants AS variant
          ON variant.id = cart_item.product_variant_id
        JOIN japan_underwear.product_colors AS color
          ON color.id = cart_item.color_id
        JOIN japan_underwear.products AS product
          ON product.id = variant.product_id
        WHERE cart_item.cart_id = $1::uuid
        ORDER BY cart_item.created_at, cart_item.id
        FOR UPDATE OF cart_item
      `,
      [cartId],
    );

    if (itemResult.rowCount === 0) {
      throw new OrderingError("Giỏ hàng đang trống.", 409, "empty_cart");
    }

    for (const row of itemResult.rows) {
      if (String(row.variant_product_id) !== String(row.color_product_id)) {
        throw new OrderingError(
          `Dòng ${row.model_code} có màu và size/cup khác sản phẩm.`,
          409,
          "selection_product_mismatch",
        );
      }
      if (!row.variant_active || !row.color_active || !row.product_active) {
        throw new OrderingError(
          `Sản phẩm ${row.model_code} có lựa chọn đã ngừng bán.`,
          409,
          "selection_inactive",
        );
      }
    }

    const currencies = new Set(itemResult.rows.map((row) => String(row.currency)));
    if (currencies.size !== 1) {
      throw new OrderingError(
        "Đơn hàng phải dùng đúng một loại tiền tệ.",
        409,
        "mixed_currency",
      );
    }

    const currency = String(itemResult.rows[0].currency);
    const subtotal = itemResult.rows.reduce(
      (sum, row) => sum + Number(row.current_unit_price) * Number(row.quantity),
      0,
    );
    const itemCount = itemResult.rows.reduce(
      (sum, row) => sum + Number(row.quantity),
      0,
    );
    const orderCode = makeOrderCode();

    const orderResult = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code,
          source_cart_id,
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
          $1, $2::uuid, 'submitted', $3, $4, $5, $6, $7,
          $8, $9, $10, $11::timestamptz, $12, $13, $14, $15::uuid, $16::uuid
        )
        RETURNING id, created_at
      `,
      [
        orderCode,
        cartId,
        profile.store_name,
        profile.contact_name,
        profile.phone,
        profile.delivery_address,
        note,
        location?.latitude ?? null,
        location?.longitude ?? null,
        location?.accuracyMeters ?? null,
        location?.collectedAt ?? null,
        location?.source ?? null,
        subtotal,
        currency,
        normalizedCustomerUserId,
        normalizedClientRequestId,
      ],
    );
    const orderId = String(orderResult.rows[0].id);
    const createdAt = new Date(orderResult.rows[0].created_at).toISOString();

    for (const row of itemResult.rows) {
      const quantity = Number(row.quantity);
      const unitPrice = Number(row.current_unit_price);
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
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
            $7, $8, $9, $10, $11, $12
          )
        `,
        [
          orderId,
          row.product_variant_id,
          row.color_id,
          quantity,
          unitPrice,
          unitPrice * quantity,
          String(row.model_code),
          String(row.product_name),
          String(row.color_code),
          String(row.color_name),
          String(row.size_code),
          row.cup_code ? String(row.cup_code) : null,
        ],
      );
    }

    await client.query(
      `
        INSERT INTO japan_underwear.outbox_events (
          aggregate_type,
          aggregate_id,
          event_type,
          payload
        ) VALUES (
          'order',
          $1::uuid,
          'order.submitted',
          jsonb_build_object(
            'orderId', $1::uuid,
            'orderCode', $2,
            'customerUserId', $3::uuid,
            'clientRequestId', $4::uuid,
            'subtotal', $5,
            'currency', $6,
            'itemCount', $7,
            'createdAt', $8::timestamptz
          )
        )
      `,
      [
        orderId,
        orderCode,
        normalizedCustomerUserId,
        normalizedClientRequestId,
        subtotal,
        currency,
        itemCount,
        createdAt,
      ],
    );

    const converted = await client.query(
      `
        UPDATE japan_underwear.carts
        SET status = 'converted', converted_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND status = 'active'
        RETURNING id
      `,
      [cartId],
    );
    if (converted.rowCount !== 1) {
      throw new OrderingError(
        "Giỏ hàng đã thay đổi trong lúc tạo đơn. Vui lòng thử lại.",
        409,
        "cart_conversion_conflict",
      );
    }

    return {
      id: orderId,
      orderCode,
      status: "submitted",
      subtotal,
      currency,
      itemCount,
      locationCaptured: Boolean(location),
      idempotentReplay: false,
      createdAt,
    };
  });
}
