import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { getPool } from "@/db/client";
import type {
  AddCartItemInput,
  CheckoutInput,
  CreatedOrder,
  ServerCart,
  ServerCartItem,
} from "@/lib/order-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrderingError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "ordering_error",
  ) {
    super(message);
    this.name = "OrderingError";
  }
}

export function normalizeCartToken(value: string | null | undefined) {
  const token = value?.trim() ?? "";
  return UUID_PATTERN.test(token) ? token.toLowerCase() : null;
}

type CartHandle = {
  id: string;
  token: string;
  created: boolean;
};

type SelectionRow = {
  variant_id: string;
  variant_product_id: string;
  variant_active: boolean;
  color_id: string;
  color_product_id: string;
  color_active: boolean;
  product_active: boolean;
  unit_price: number | string;
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

async function ensureActiveCart(client: PoolClient, requestedToken: string | null): Promise<CartHandle> {
  if (requestedToken) {
    const existing = await client.query(
      `
        SELECT id, token
        FROM japan_underwear.carts
        WHERE token = $1::uuid
          AND status = 'active'
        LIMIT 1
        FOR UPDATE
      `,
      [requestedToken],
    );
    if (existing.rowCount === 1) {
      return {
        id: String(existing.rows[0].id),
        token: String(existing.rows[0].token),
        created: false,
      };
    }
  }

  const token = randomUUID();
  const inserted = await client.query(
    `
      INSERT INTO japan_underwear.carts (token, status)
      VALUES ($1::uuid, 'active')
      RETURNING id, token
    `,
    [token],
  );
  return {
    id: String(inserted.rows[0].id),
    token: String(inserted.rows[0].token),
    created: true,
  };
}

async function findActiveCartForUpdate(client: PoolClient, token: string | null) {
  if (!token) return null;
  const result = await client.query(
    `
      SELECT id, token
      FROM japan_underwear.carts
      WHERE token = $1::uuid
        AND status = 'active'
      LIMIT 1
      FOR UPDATE
    `,
    [token],
  );
  if (result.rowCount !== 1) return null;
  return { id: String(result.rows[0].id), token: String(result.rows[0].token) };
}

function variantLabel(size: string, cup: string | null) {
  return cup ? `${size}${cup}` : size;
}

async function loadCart(client: PoolClient, cartId: string): Promise<ServerCart> {
  const result = await client.query(
    `
      SELECT
        cart_item.id,
        product.id AS product_id,
        variant.id AS product_variant_id,
        color.id AS color_id,
        product.model_code,
        product.name AS product_name,
        product.currency,
        color.code AS color_code,
        color.name AS color_name,
        variant.size_code,
        variant.cup_code,
        cart_item.quantity,
        cart_item.unit_price_snapshot
      FROM japan_underwear.cart_items AS cart_item
      JOIN japan_underwear.product_variants AS variant
        ON variant.id = cart_item.product_variant_id
      JOIN japan_underwear.product_colors AS color
        ON color.id = cart_item.color_id
      JOIN japan_underwear.products AS product
        ON product.id = variant.product_id
      WHERE cart_item.cart_id = $1::uuid
      ORDER BY cart_item.created_at, cart_item.id
    `,
    [cartId],
  );

  const items: ServerCartItem[] = result.rows.map((row) => {
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unit_price_snapshot);
    const size = String(row.size_code);
    const cup = row.cup_code ? String(row.cup_code) : null;
    return {
      id: String(row.id),
      productId: String(row.product_id),
      productVariantId: String(row.product_variant_id),
      colorId: String(row.color_id),
      productCode: String(row.model_code),
      productName: String(row.product_name),
      colorCode: String(row.color_code),
      colorLabel: String(row.color_name),
      size,
      cup,
      variantLabel: variantLabel(size, cup),
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      currency: String(row.currency),
    };
  });

  const currencies = new Set(items.map((item) => item.currency));
  if (currencies.size > 1) {
    throw new OrderingError("Giỏ hàng có nhiều loại tiền tệ và không thể thanh toán.", 409, "mixed_currency");
  }

  return {
    items,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    currency: items[0]?.currency ?? "VND",
  };
}

async function resolveSelection(
  client: PoolClient,
  productVariantId: string,
  colorId: string,
): Promise<SelectionRow> {
  const result = await client.query(
    `
      SELECT
        variant.id AS variant_id,
        variant.product_id AS variant_product_id,
        variant.is_active AS variant_active,
        color.id AS color_id,
        color.product_id AS color_product_id,
        color.is_active AS color_active,
        product.is_active AS product_active,
        COALESCE(variant.price_override, product.base_price) AS unit_price
      FROM japan_underwear.product_variants AS variant
      JOIN japan_underwear.products AS product
        ON product.id = variant.product_id
      JOIN japan_underwear.product_colors AS color
        ON color.id = $2::uuid
      WHERE variant.id = $1::uuid
      LIMIT 1
    `,
    [productVariantId, colorId],
  );

  if (result.rowCount !== 1) {
    throw new OrderingError("Không tìm thấy size/cup hoặc màu đã chọn.", 404, "selection_not_found");
  }

  const row = result.rows[0] as SelectionRow;
  if (String(row.variant_product_id) !== String(row.color_product_id)) {
    throw new OrderingError(
      "Màu và size/cup không thuộc cùng một sản phẩm.",
      409,
      "selection_product_mismatch",
    );
  }
  if (!row.variant_active || !row.color_active || !row.product_active) {
    throw new OrderingError("Sản phẩm, màu hoặc size/cup đã ngừng bán.", 409, "selection_inactive");
  }
  return row;
}

export async function getServerCart(requestedToken: string | null) {
  return withTransaction(async (client) => {
    const handle = await ensureActiveCart(client, requestedToken);
    return {
      token: handle.token,
      tokenChanged: handle.created || handle.token !== requestedToken,
      cart: await loadCart(client, handle.id),
    };
  });
}

export async function addServerCartItems(
  requestedToken: string | null,
  inputs: AddCartItemInput[],
) {
  const consolidated = new Map<string, AddCartItemInput>();
  for (const input of inputs) {
    const key = `${input.productVariantId}:${input.colorId}`;
    const existing = consolidated.get(key);
    consolidated.set(key, {
      ...input,
      quantity: (existing?.quantity ?? 0) + input.quantity,
    });
  }

  return withTransaction(async (client) => {
    const handle = await ensureActiveCart(client, requestedToken);
    for (const input of consolidated.values()) {
      if (input.quantity > 999) {
        throw new OrderingError("Số lượng mỗi dòng không được vượt quá 999.", 400, "quantity_limit");
      }
      const selection = await resolveSelection(
        client,
        input.productVariantId,
        input.colorId,
      );
      const upsert = await client.query(
        `
          INSERT INTO japan_underwear.cart_items (
            cart_id,
            product_variant_id,
            color_id,
            quantity,
            unit_price_snapshot
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
          ON CONFLICT (cart_id, product_variant_id, color_id)
          DO UPDATE SET
            quantity = japan_underwear.cart_items.quantity + EXCLUDED.quantity,
            unit_price_snapshot = EXCLUDED.unit_price_snapshot,
            updated_at = now()
          WHERE japan_underwear.cart_items.quantity + EXCLUDED.quantity <= 999
          RETURNING id
        `,
        [
          handle.id,
          input.productVariantId,
          input.colorId,
          input.quantity,
          Number(selection.unit_price),
        ],
      );
      if (upsert.rowCount !== 1) {
        throw new OrderingError("Tổng số lượng một dòng không được vượt quá 999.", 409, "quantity_limit");
      }
    }

    await client.query(
      "UPDATE japan_underwear.carts SET updated_at = now() WHERE id = $1::uuid",
      [handle.id],
    );
    return {
      token: handle.token,
      tokenChanged: handle.created || handle.token !== requestedToken,
      cart: await loadCart(client, handle.id),
    };
  });
}

export async function updateServerCartItem(
  requestedToken: string | null,
  itemId: string,
  quantity: number,
) {
  return withTransaction(async (client) => {
    const handle = await findActiveCartForUpdate(client, requestedToken);
    if (!handle) {
      throw new OrderingError("Không tìm thấy giỏ hàng đang hoạt động.", 404, "cart_not_found");
    }

    const updated = await client.query(
      `
        UPDATE japan_underwear.cart_items
        SET quantity = $3, updated_at = now()
        WHERE id = $1::uuid
          AND cart_id = $2::uuid
        RETURNING id
      `,
      [itemId, handle.id, quantity],
    );
    if (updated.rowCount !== 1) {
      throw new OrderingError("Không tìm thấy dòng giỏ hàng.", 404, "cart_item_not_found");
    }
    await client.query(
      "UPDATE japan_underwear.carts SET updated_at = now() WHERE id = $1::uuid",
      [handle.id],
    );
    return { token: handle.token, tokenChanged: false, cart: await loadCart(client, handle.id) };
  });
}

export async function deleteServerCartItem(requestedToken: string | null, itemId: string) {
  return withTransaction(async (client) => {
    const handle = await findActiveCartForUpdate(client, requestedToken);
    if (!handle) {
      throw new OrderingError("Không tìm thấy giỏ hàng đang hoạt động.", 404, "cart_not_found");
    }
    const deleted = await client.query(
      `
        DELETE FROM japan_underwear.cart_items
        WHERE id = $1::uuid
          AND cart_id = $2::uuid
        RETURNING id
      `,
      [itemId, handle.id],
    );
    if (deleted.rowCount !== 1) {
      throw new OrderingError("Không tìm thấy dòng giỏ hàng.", 404, "cart_item_not_found");
    }
    await client.query(
      "UPDATE japan_underwear.carts SET updated_at = now() WHERE id = $1::uuid",
      [handle.id],
    );
    return { token: handle.token, tokenChanged: false, cart: await loadCart(client, handle.id) };
  });
}

function makeOrderCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TT-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createServerOrder(
  requestedToken: string | null,
  input: CheckoutInput,
): Promise<CreatedOrder> {
  return withTransaction(async (client) => {
    const handle = await findActiveCartForUpdate(client, requestedToken);
    if (!handle) {
      throw new OrderingError("Giỏ hàng không tồn tại hoặc đã được tạo đơn.", 409, "cart_unavailable");
    }

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
          product.base_price,
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
      [handle.id],
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
      throw new OrderingError("Đơn hàng phải dùng đúng một loại tiền tệ.", 409, "mixed_currency");
    }
    const currency = String(itemResult.rows[0].currency);
    const subtotal = itemResult.rows.reduce(
      (sum, row) => sum + Number(row.current_unit_price) * Number(row.quantity),
      0,
    );
    const orderCode = makeOrderCode();

    const orderResult = await client.query(
      `
        INSERT INTO japan_underwear.orders (
          order_code,
          source_cart_id,
          status,
          customer_name,
          customer_phone,
          delivery_address,
          note,
          subtotal,
          currency
        )
        VALUES ($1, $2::uuid, 'submitted', $3, $4, $5, $6, $7, $8)
        RETURNING id, created_at
      `,
      [
        orderCode,
        handle.id,
        input.customerName.trim(),
        input.customerPhone.trim(),
        input.deliveryAddress?.trim() || null,
        input.note?.trim() || null,
        subtotal,
        currency,
      ],
    );
    const orderId = String(orderResult.rows[0].id);

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
          )
          VALUES (
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
        UPDATE japan_underwear.carts
        SET status = 'converted', converted_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND status = 'active'
      `,
      [handle.id],
    );

    return {
      id: orderId,
      orderCode,
      status: "submitted",
      subtotal,
      currency,
      itemCount: itemResult.rows.reduce((sum, row) => sum + Number(row.quantity), 0),
      createdAt: new Date(orderResult.rows[0].created_at).toISOString(),
    };
  });
}
