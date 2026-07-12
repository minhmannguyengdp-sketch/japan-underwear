import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  clearCartCookie,
  orderingErrorResponse,
  readCartToken,
} from "@/lib/cart-http";
import { createServerOrder } from "@/lib/server-ordering";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z
    .string()
    .trim()
    .min(8)
    .max(24)
    .regex(/^[0-9+().\s-]+$/),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = checkoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Tên hoặc số điện thoại đặt hàng không hợp lệ.", code: "invalid_checkout" },
        { status: 400 },
      );
    }

    const order = await createServerOrder(readCartToken(request), parsed.data);
    return clearCartCookie(NextResponse.json({ order }, { status: 201 }));
  } catch (error) {
    return orderingErrorResponse(error);
  }
}
