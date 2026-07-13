import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { orderingErrorResponse, readCartToken } from "@/lib/cart-http";
import {
  deleteServerCartItem,
  updateServerCartItem,
} from "@/lib/server-ordering";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

const quantitySchema = z.object({
  quantity: z.number().int().min(1).max(999),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    if (!z.string().uuid().safeParse(itemId).success) {
      return NextResponse.json(
        { error: "Mã dòng giỏ hàng không hợp lệ.", code: "invalid_cart_item_id" },
        { status: 400 },
      );
    }
    const parsed = quantitySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Số lượng không hợp lệ.", code: "invalid_quantity" },
        { status: 400 },
      );
    }
    const result = await updateServerCartItem(
      readCartToken(request),
      itemId,
      parsed.data.quantity,
    );
    return NextResponse.json({ cart: result.cart });
  } catch (error) {
    return orderingErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    if (!z.string().uuid().safeParse(itemId).success) {
      return NextResponse.json(
        { error: "Mã dòng giỏ hàng không hợp lệ.", code: "invalid_cart_item_id" },
        { status: 400 },
      );
    }
    const result = await deleteServerCartItem(readCartToken(request), itemId);
    return NextResponse.json({ cart: result.cart });
  } catch (error) {
    return orderingErrorResponse(error);
  }
}
