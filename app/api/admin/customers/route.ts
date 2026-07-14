import { NextRequest, NextResponse } from "next/server";

import { adminCustomerApiErrorResponse } from "@/lib/admin-customer-http";
import { listAdminCustomers } from "@/lib/admin-customers";
import { requireRole, STAFF_ROLES } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireRole(STAFF_ROLES);
    const customers = await listAdminCustomers(
      request.nextUrl.searchParams.get("q"),
    );
    return NextResponse.json({ customers });
  } catch (error) {
    return adminCustomerApiErrorResponse(error);
  }
}
