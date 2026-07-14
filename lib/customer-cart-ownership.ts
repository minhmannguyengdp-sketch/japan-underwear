import type { PoolClient } from "pg";

import { getPool } from "@/db/client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CustomerCartOwnershipError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 409,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CustomerCartOwnershipError";
  }
}

function normalizeUuid(value: string | null, label: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerCartOwnershipError(`${label} không hợp lệ.`, 400, "invalid_cart_owner_input");
  }
  return normalized;
}

async function lockActiveCart(client: PoolClient, cartToken: string) {
  const result = await client.query(
    `
      SELECT id, customer_user_id
      FROM japan_underwear.carts
      WHERE token = $1::uuid
        AND status = 'active'
      LIMIT 1
      FOR UPDATE
    `,
    [cartToken],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function bindCustomerCartOwner(
  requestedToken: string | null,
  userId: string,
) {
  const cartToken = normalizeUuid(requestedToken, "Giỏ hàng");
  const normalizedUserId = normalizeUuid(userId, "Danh tính người dùng");
  const client = await getPool().connect();
  await client.query("BEGIN");

  try {
    const cart = await lockActiveCart(client, cartToken);
    if (!cart) {
      throw new CustomerCartOwnershipError(
        "Giỏ hàng không tồn tại hoặc đã được tạo đơn.",
        409,
        "cart_unavailable",
      );
    }

    if (cart.customer_user_id && String(cart.customer_user_id) !== normalizedUserId) {
      throw new CustomerCartOwnershipError(
        "Giỏ hàng này đã thuộc một tài khoản khác.",
        409,
        "cart_owner_conflict",
      );
    }

    if (!cart.customer_user_id) {
      await client.query(
        `
          UPDATE japan_underwear.carts
          SET customer_user_id = $2::uuid, updated_at = now()
          WHERE id = $1::uuid
        `,
        [cart.id, normalizedUserId],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
