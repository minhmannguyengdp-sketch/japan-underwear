import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { updateManagedColor } from "@/lib/catalog-admin";
import { catalogAdminApiErrorResponse } from "@/lib/catalog-admin-http";

export const dynamic = "force-dynamic";

const colorUpdateSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(160).optional(),
    swatch: z.string().trim().max(64).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.swatch !== undefined ||
      value.sortOrder !== undefined ||
      value.isActive !== undefined,
    { message: "Không có thay đổi màu để lưu." },
  );

type RouteContext = {
  params: Promise<{ colorId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireRole(["admin"] as const);
    const parsed = colorUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Dữ liệu màu không hợp lệ.",
          code: "invalid_catalog_color_update",
        },
        { status: 400 },
      );
    }

    const { colorId } = await context.params;
    const { requestId, ...input } = parsed.data;
    const result = await updateManagedColor(
      colorId,
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
