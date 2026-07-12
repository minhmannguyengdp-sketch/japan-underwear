import { NextRequest, NextResponse } from "next/server";

import { OrderingError, normalizeCartToken } from "@/lib/server-ordering";

export const CART_COOKIE_NAME = "tt_cart";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function readCartToken(request: NextRequest) {
  return normalizeCartToken(request.cookies.get(CART_COOKIE_NAME)?.value);
}

export function attachCartCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: CART_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return response;
}

export function clearCartCookie(response: NextResponse) {
  response.cookies.set({
    name: CART_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function orderingErrorResponse(error: unknown) {
  if (error instanceof OrderingError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("Ordering API failed:", error instanceof Error ? error.message : String(error));
  return NextResponse.json(
    { error: "Không xử lý được giỏ hàng hoặc đơn hàng.", code: "internal_error" },
    { status: 500 },
  );
}
