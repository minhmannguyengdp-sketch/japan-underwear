import type { PoolClient } from "pg";

import {
  createOrderFromSelections,
  normalizeOrderUuid,
  type OrderCustomerSnapshot,
  type OrderSelectionInput,
  withOrderTransaction,
} from "@/lib/order-creation";
import type { CreatedOrder } from "@/lib/order-types";
import { StaffOrderError } from "@/lib/staff-orders";

export type ManualOrderInput = {
  clientRequestId: string;
  customerUserId?: string | null;
  guestCustomer?: OrderCustomerSnapshot | null;
  note?: string | null;
  items: OrderSelectionInput[];
};

type CustomerProfileRow = {
  store_name: string;
  contact_name: string;
  phone: string;
  delivery_address: string;
};

async function findExistingManualOrder(
  client: PoolClient,
  actorUserId: string,
  manualRequestId: string,
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
      WHERE orders.order_source = 'staff_manual'
        AND orders.created_by_user_id = $1::uuid
        AND orders.manual_request_id = $2::uuid
      GROUP BY orders.id
      LIMIT 1
    `,
    [actorUserId, manualRequestId],
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

async function loadLinkedCustomer(
  client: PoolClient,
  customerUserId: string,
): Promise<CustomerProfileRow> {
  const userResult = await client.query(
    `
      SELECT
        auth_user.status,
        EXISTS (
          SELECT 1
          FROM japan_underwear.user_roles AS role
          WHERE role.user_id = auth_user.id
            AND role.role = 'customer'
        ) AS is_customer
      FROM japan_underwear.users AS auth_user
      WHERE auth_user.id = $1::uuid
      LIMIT 1
      FOR SHARE
    `,
    [customerUserId],
  );
  if (userResult.rowCount !== 1 || !userResult.rows[0].is_customer) {
    throw new StaffOrderError(
      "Không tìm thấy tài khoản khách hàng.",
      404,
      "manual_order_customer_not_found",
    );
  }
  if (userResult.rows[0].status !== "active") {
    throw new StaffOrderError(
      "Không thể tạo đơn cho tài khoản đang bị khóa.",
      409,
      "manual_order_customer_blocked",
    );
  }

  const profileResult = await client.query(
    `
      SELECT store_name, contact_name, phone, delivery_address
      FROM japan_underwear.customer_profiles
      WHERE user_id = $1::uuid
      LIMIT 1
      FOR SHARE
    `,
    [customerUserId],
  );
  if (profileResult.rowCount !== 1) {
    throw new StaffOrderError(
      "Khách hàng chưa hoàn tất hồ sơ cửa hàng và giao hàng.",
      409,
      "manual_order_customer_profile_required",
    );
  }
  return profileResult.rows[0] as CustomerProfileRow;
}

export async function createIdempotentManualOrder(
  actorUserId: string,
  actorLabel: string,
  input: ManualOrderInput,
): Promise<CreatedOrder> {
  const normalizedActorUserId = normalizeOrderUuid(
    actorUserId,
    "invalid_manual_order_actor",
  );
  const manualRequestId = normalizeOrderUuid(
    input.clientRequestId,
    "invalid_manual_request_id",
  );
  const normalizedActorLabel = actorLabel.trim();
  if (!normalizedActorLabel || normalizedActorLabel.length > 120) {
    throw new StaffOrderError(
      "Không xác định được người tạo đơn.",
      400,
      "invalid_manual_order_actor",
    );
  }

  const hasLinkedCustomer = Boolean(input.customerUserId);
  const hasGuestCustomer = Boolean(input.guestCustomer);
  if (hasLinkedCustomer === hasGuestCustomer) {
    throw new StaffOrderError(
      "Chọn đúng một nguồn khách hàng: tài khoản hiện có hoặc khách vãng lai.",
      400,
      "invalid_manual_order_customer_mode",
    );
  }
  const customerUserId = input.customerUserId
    ? normalizeOrderUuid(input.customerUserId, "invalid_customer_user_id")
    : null;

  return withOrderTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [`staff-manual:${normalizedActorUserId}`, manualRequestId],
    );

    const replay = await findExistingManualOrder(
      client,
      normalizedActorUserId,
      manualRequestId,
    );
    if (replay) return replay;

    let customer: OrderCustomerSnapshot;
    if (customerUserId) {
      const profile = await loadLinkedCustomer(client, customerUserId);
      customer = {
        storeName: profile.store_name,
        name: profile.contact_name,
        phone: profile.phone,
        deliveryAddress: profile.delivery_address,
        note: input.note,
        location: null,
      };
    } else {
      const guestCustomer = input.guestCustomer;
      if (!guestCustomer) {
        throw new StaffOrderError(
          "Thiếu thông tin khách vãng lai.",
          400,
          "manual_order_guest_required",
        );
      }
      customer = {
        ...guestCustomer,
        note: input.note,
        location: null,
      };
    }

    return createOrderFromSelections(client, {
      source: "staff_manual",
      sourceCartId: null,
      customerUserId,
      clientRequestId: null,
      manualRequestId,
      createdByUserId: normalizedActorUserId,
      customer,
      selections: input.items,
      actorSource: "staff_manual",
      actorLabel: normalizedActorLabel,
      auditIdempotencyKey: `staff-manual:${normalizedActorUserId}:${manualRequestId}`,
    });
  });
}