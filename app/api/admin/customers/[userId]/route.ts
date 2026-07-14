import { NextResponse } from "next/server";

import { adminCustomerApiErrorResponse } from "@/lib/admin-customer-http";
import { getAdminCustomer } from "@/lib/admin-customers";
import { requireRole, STAFF_ROLES } from "@/lib/authz";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireRole(STAFF_ROLES);
    const { userId } = await context.params;
    const customer = await getAdminCustomer(userId);
    return NextResponse.json({ customer });
  } catch (error) {
    return adminCustomerApiErrorResponse(error);
  }
}
