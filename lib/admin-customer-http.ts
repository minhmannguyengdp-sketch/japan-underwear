import { NextResponse } from "next/server";

import { AdminCustomerError } from "@/lib/admin-customers";
import { AuthorizationError } from "@/lib/authz";

export function adminCustomerApiErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError || error instanceof AdminCustomerError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(
    "Admin customer API failed:",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: "Không xử lý được yêu cầu quản lý khách hàng.", code: "internal_error" },
    { status: 500 },
  );
}
