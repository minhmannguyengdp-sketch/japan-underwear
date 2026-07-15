import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/authz";
import { OrderingError } from "@/lib/server-ordering";
import { StaffOrderError } from "@/lib/staff-orders";

function isInvalidColorVariantSelection(error: unknown) {
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return (
    databaseError?.code === "23514" &&
    databaseError?.constraint === "orderable_color_variant_selection_chk"
  );
}

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

  if (isInvalidColorVariantSelection(error)) {
    return NextResponse.json(
      {
        error: "Màu và size/cup đã chọn không phải tổ hợp đang được bán.",
        code: "invalid_color_variant_selection",
      },
      { status: 409 },
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
