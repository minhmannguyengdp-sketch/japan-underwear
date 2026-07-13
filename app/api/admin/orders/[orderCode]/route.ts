import { NextResponse } from "next/server";

import { requireRole, STAFF_ROLES } from "@/lib/authz";
import { staffApiErrorResponse } from "@/lib/staff-http";
import { getStaffOrder } from "@/lib/staff-orders";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderCode: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireRole(STAFF_ROLES);
    const { orderCode } = await context.params;
    const order = await getStaffOrder(orderCode);
    return NextResponse.json({ order });
  } catch (error) {
    return staffApiErrorResponse(error);
  }
}
