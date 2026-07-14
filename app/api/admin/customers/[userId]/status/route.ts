import { NextResponse } from "next/server";
import { z } from "zod";

import { adminCustomerApiErrorResponse } from "@/lib/admin-customer-http";
import {
  getAdminCustomer,
  setAdminCustomerStatus,
} from "@/lib/admin-customers";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["active", "blocked"]),
});

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireRole(["admin"] as const);
    const parsed = statusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Trạng thái khách hàng không hợp lệ.", code: "invalid_customer_status" },
        { status: 400 },
      );
    }

    const { userId } = await context.params;
    const change = await setAdminCustomerStatus(userId, {
      targetStatus: parsed.data.status,
      actorUserId: actor.userId,
      actorLabel: actor.email ?? actor.userId,
    });
    const customer = await getAdminCustomer(userId);
    return NextResponse.json({ change, customer });
  } catch (error) {
    return adminCustomerApiErrorResponse(error);
  }
}
