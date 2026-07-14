import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/authz";
import { customerOrderApiErrorResponse } from "@/lib/customer-order-http";
import { getCustomerOrder } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderCode: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await requireAuthenticatedUser();
    const { orderCode } = await context.params;
    const order = await getCustomerOrder(authorization.userId, orderCode);
    return NextResponse.json({ order });
  } catch (error) {
    return customerOrderApiErrorResponse(error);
  }
}
