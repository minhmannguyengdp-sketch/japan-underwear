import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  attachCartCookie,
  orderingErrorResponse,
  readCartToken,
} from "@/lib/cart-http";
import { addServerCartItems } from "@/lib/server-ordering";

export const dynamic = "force-dynamic";

const addItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productVariantId: z.string().uuid(),
        colorId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = addItemsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dữ liệu thêm vào giỏ không hợp lệ.", code: "invalid_cart_items" },
        { status: 400 },
      );
    }

    const result = await addServerCartItems(readCartToken(request), parsed.data.items);
    const response = NextResponse.json({ cart: result.cart });
    return result.tokenChanged ? attachCartCookie(response, result.token) : response;
  } catch (error) {
    return orderingErrorResponse(error);
  }
}
