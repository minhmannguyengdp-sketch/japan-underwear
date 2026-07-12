import { NextRequest, NextResponse } from "next/server";

import {
  attachCartCookie,
  orderingErrorResponse,
  readCartToken,
} from "@/lib/cart-http";
import { getServerCart } from "@/lib/server-ordering";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await getServerCart(readCartToken(request));
    const response = NextResponse.json({ cart: result.cart });
    return result.tokenChanged ? attachCartCookie(response, result.token) : response;
  } catch (error) {
    return orderingErrorResponse(error);
  }
}
