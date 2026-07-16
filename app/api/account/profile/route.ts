import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import {
  CustomerProfileError,
  getCustomerProfile,
  saveCustomerProfile,
} from "@/lib/customer-profile";

export const dynamic = "force-dynamic";

const shopLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().positive().max(100000),
  collectedAt: z.string().datetime(),
  source: z.literal("browser_geolocation"),
});

const profileSchema = z.object({
  storeName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(24)
    .regex(/^[0-9+().\s-]+$/),
  deliveryAddress: z.string().trim().min(5).max(500),
  shopLocation: shopLocationSchema.nullable().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError || error instanceof CustomerProfileError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(
    "Customer profile API failed:",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: "Không xử lý được hồ sơ khách hàng.", code: "internal_error" },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const context = await requireAuthenticatedUser();
    const profile = await getCustomerProfile(context.userId);
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireAuthenticatedUser();
    const parsed = profileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Tên cửa hàng, người liên hệ, điện thoại, địa chỉ hoặc vị trí chưa hợp lệ.",
          code: "invalid_customer_profile",
        },
        { status: 400 },
      );
    }

    const profile = await saveCustomerProfile(context.userId, parsed.data);
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
