import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { updateManagedProduct } from "@/lib/catalog-admin";
import { catalogAdminApiErrorResponse } from "@/lib/catalog-admin-http";

export const dynamic = "force-dynamic";

const productUpdateSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(240).optional(),
    shortDescription: z.string().trim().max(2000).nullable().optional(),
    basePrice: z.number().int().min(0).max(2_147_483_647).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.shortDescription !== undefined ||
      value.basePrice !== undefined ||
      value.isActive !== undefined,
    { message: "Không có thay đổi sản phẩm để lưu." },
  );

type RouteContext = {
  params: Promise<{ productId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireRole(["admin"] as const);
    const parsed = productUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Dữ liệu sản phẩm không hợp lệ.",
          code: "invalid_catalog_product_update",
        },
        { status: 400 },
      );
    }

    const { productId } = await context.params;
    const { requestId, ...input } = parsed.data;
    const result = await updateManagedProduct(
      productId,
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
