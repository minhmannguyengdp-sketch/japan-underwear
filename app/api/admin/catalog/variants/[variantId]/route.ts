import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { updateManagedVariant } from "@/lib/catalog-admin";
import { catalogAdminApiErrorResponse } from "@/lib/catalog-admin-http";

export const dynamic = "force-dynamic";

const variantUpdateSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    sku: z.string().trim().max(160).nullable().optional(),
    priceOverride: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.sku !== undefined ||
      value.priceOverride !== undefined ||
      value.isActive !== undefined,
    { message: "Không có thay đổi biến thể để lưu." },
  );

type RouteContext = {
  params: Promise<{ variantId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireRole(["admin"] as const);
    const parsed = variantUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Dữ liệu biến thể không hợp lệ.",
          code: "invalid_catalog_variant_update",
        },
        { status: 400 },
      );
    }

    const { variantId } = await context.params;
    const { requestId, ...input } = parsed.data;
    const result = await updateManagedVariant(
      variantId,
      {
        userId: actor.userId,
        label: actor.email ?? actor.name ?? actor.userId,
        requestId,
      },
      input,
    );
    return NextResponse.json(result);
  } catch (error) {
    return catalogAdminApiErrorResponse(error);
  }
}
