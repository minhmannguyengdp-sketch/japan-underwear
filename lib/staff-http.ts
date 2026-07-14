import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/authz";
import { OrderingError } from "@/lib/server-ordering";
import { StaffOrderError } from "@/lib/staff-orders";

export function staffApiErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof StaffOrderError || error instanceof OrderingError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(
    "Staff order API failed:",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: "Không xử lý được yêu cầu quản lý đơn.", code: "internal_error" },
    { status: 500 },
  );
}