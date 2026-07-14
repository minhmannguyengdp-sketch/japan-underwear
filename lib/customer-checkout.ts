import type { PoolClient } from "pg";

import type { CheckoutLocationInput, CreatedOrder } from "@/lib/order-types";
import {
  createOrderFromSelections,
  normalizeOrderUuid,
  type OrderSelectionInput,
  withOrderTransaction,
} from "@/lib/order-creation";
import { OrderingError } from "@/lib/server-ordering";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  } satisfies CheckoutLocationInput;
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
  const normalizedCustomerUserId = normalizeOrderUuid(
    customerUserId,
    "invalid_customer_user_id",
  );
  const normalizedClientRequestId = normalizeOrderUuid(
    input.clientRequestId,
    "invalid_client_request_id",
  );
  const location = normalizeCheckoutLocation(input.location);
  const cartToken = requestedToken?.trim().toLowerCase() ?? "";

  return withOrderTransaction(async (client) => {
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

    if (!UUID_PATTERN.test(cartToken)) {
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
      [cartToken],
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
        SELECT product_variant_id, color_id, quantity
        FROM japan_underwear.cart_items
        WHERE cart_id = $1::uuid
        ORDER BY created_at, id
        FOR UPDATE
      `,
      [cartId],
    );
    if (itemResult.rowCount === 0) {
      throw new OrderingError("Giỏ hàng đang trống.", 409, "empty_cart");
    }

    const selections: OrderSelectionInput[] = itemResult.rows.map((row) => ({
      productVariantId: String(row.product_variant_id),
      colorId: String(row.color_id),
      quantity: Number(row.quantity),
    }));

    const order = await createOrderFromSelections(client, {
      source: "customer_checkout",
      sourceCartId: cartId,
      customerUserId: normalizedCustomerUserId,
      clientRequestId: normalizedClientRequestId,
      manualRequestId: null,
      createdByUserId: null,
      customer: {
        storeName: profile.store_name,
        name: profile.contact_name,
        phone: profile.phone,
        deliveryAddress: profile.delivery_address,
        note: input.note,
        location,
      },
      selections,
      actorSource: "checkout",
      actorLabel: "customer-checkout",
      auditIdempotencyKey: `checkout:${cartId}`,
    });

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

    return order;
  });
}