import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, STAFF_ROLES } from "@/lib/authz";
import { createIdempotentManualOrder } from "@/lib/manual-orders";
import { staffApiErrorResponse } from "@/lib/staff-http";

export const dynamic = "force-dynamic";

const guestCustomerSchema = z.object({
  storeName: z.string().trim().max(160).optional().nullable(),
  name: z.string().trim().min(1).max(160),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(24)
    .regex(/^[0-9+().\s-]+$/),
  deliveryAddress: z.string().trim().max(1000).optional().nullable(),
});

const manualOrderSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    customerUserId: z.string().uuid().optional().nullable(),
    guestCustomer: guestCustomerSchema.optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
    items: z
      .array(
        z.object({
          productVariantId: z.string().uuid(),
          colorId: z.string().uuid(),
          quantity: z.number().int().min(1).max(999),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((value, context) => {
    const modes = Number(Boolean(value.customerUserId)) + Number(Boolean(value.guestCustomer));
    if (modes !== 1) {
      context.addIssue({
        code: "custom",
        path: ["customerUserId"],
        message: "Chọn đúng một nguồn khách hàng.",
      });
    }
  });

export async function POST(request: NextRequest) {
  try {
    const context = await requireRole(STAFF_ROLES);
    const parsed = manualOrderSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Thông tin tạo đơn tay không hợp lệ.",
          code: "invalid_manual_order",
        },
        { status: 400 },
      );
    }

    const actorLabel = (context.email ?? context.name ?? context.userId).slice(0, 120);
    const order = await createIdempotentManualOrder(context.userId, actorLabel, {
      clientRequestId: parsed.data.clientRequestId,
      customerUserId: parsed.data.customerUserId,
      guestCustomer: parsed.data.guestCustomer,
      note: parsed.data.note,
      items: parsed.data.items,
    });

    return NextResponse.json(
      { order },
      { status: order.idempotentReplay ? 200 : 201 },
    );
  } catch (error) {
    return staffApiErrorResponse(error);
  }
}