import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/lib/authz";
import { clearCartCookie, readCartToken } from "@/lib/cart-http";
import { customerOrderApiErrorResponse } from "@/lib/customer-order-http";
import { listCustomerOrders } from "@/lib/customer-orders";
import { createServerOrder } from "@/lib/server-ordering";

export const dynamic = "force-dynamic";

const MAX_LOCATION_AGE_MS = 30 * 60 * 1000;
const MAX_LOCATION_FUTURE_MS = 5 * 60 * 1000;

const locationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().positive().max(100000),
    collectedAt: z.string().datetime({ offset: true }),
    source: z.literal("browser_geolocation"),
  })
  .superRefine((location, context) => {
    const collectedAt = Date.parse(location.collectedAt);
    const now = Date.now();
    if (collectedAt < now - MAX_LOCATION_AGE_MS) {
      context.addIssue({
        code: "custom",
        path: ["collectedAt"],
        message: "Vị trí đã quá cũ. Vui lòng lấy lại vị trí hiện tại.",
      });
    }
    if (collectedAt > now + MAX_LOCATION_FUTURE_MS) {
      context.addIssue({
        code: "custom",
        path: ["collectedAt"],
        message: "Thời điểm lấy vị trí không hợp lệ.",
      });
    }
  });

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
  location: locationSchema.optional().nullable(),
});

export async function GET() {
  try {
    const context = await requireAuthenticatedUser();
    const orders = await listCustomerOrders(context.userId);
    return NextResponse.json({ orders });
  } catch (error) {
    return customerOrderApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthenticatedUser();
    const parsed = checkoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      const locationIssue = parsed.error.issues.find((issue) => issue.path[0] === "location");
      return NextResponse.json(
        {
          error:
            locationIssue?.message ??
            "Tên, số điện thoại hoặc thông tin tạo đơn không hợp lệ.",
          code: locationIssue ? "invalid_checkout_location" : "invalid_checkout",
        },
        { status: 400 },
      );
    }

    const order = await createServerOrder(
      readCartToken(request),
      context.userId,
      parsed.data,
    );
    return clearCartCookie(NextResponse.json({ order }, { status: 201 }));
  } catch (error) {
    return customerOrderApiErrorResponse(error);
  }
}
