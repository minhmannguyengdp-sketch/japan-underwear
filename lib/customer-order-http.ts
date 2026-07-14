import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/authz";
import { CustomerCartOwnershipError } from "@/lib/customer-cart-ownership";
import { CustomerOrderError } from "@/lib/customer-orders";
import { OrderingError } from "@/lib/server-ordering";

export function customerOrderApiErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (
    error instanceof CustomerCartOwnershipError ||
    error instanceof CustomerOrderError ||
    error instanceof OrderingError
  ) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(
    "Customer order API failed:",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: "Không xử lý được yêu cầu đơn hàng.", code: "internal_error" },
    { status: 500 },
  );
}
