import { NextRequest, NextResponse } from "next/server";

import { requireRole, STAFF_ROLES } from "@/lib/authz";
import { staffApiErrorResponse } from "@/lib/staff-http";
import {
  isStaffOrderStatus,
  listStaffOrders,
} from "@/lib/staff-orders";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireRole(STAFF_ROLES);

    const rawStatus = request.nextUrl.searchParams.get("status");
    if (rawStatus && !isStaffOrderStatus(rawStatus)) {
      return NextResponse.json(
        { error: "Bộ lọc trạng thái không hợp lệ.", code: "invalid_status_filter" },
        { status: 400 },
      );
    }

    const orders = await listStaffOrders(rawStatus || null);
    return NextResponse.json({ orders });
  } catch (error) {
    return staffApiErrorResponse(error);
  }
}
