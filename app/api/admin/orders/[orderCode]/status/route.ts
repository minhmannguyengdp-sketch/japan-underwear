import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, STAFF_ROLES } from "@/lib/authz";
import { staffApiErrorResponse } from "@/lib/staff-http";
import { transitionStaffOrder } from "@/lib/staff-orders";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderCode: string }>;
};

const transitionSchema = z
  .object({
    status: z.enum(["confirmed", "processing", "completed", "cancelled"]),
    reason: z.string().trim().max(1000).optional().nullable(),
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .superRefine((value, context) => {
    if (value.status === "cancelled" && !value.reason?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Hủy đơn bắt buộc có lý do.",
      });
    }
  });

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireRole(STAFF_ROLES);
    const { orderCode } = await context.params;
    const body = await request.json().catch(() => null);
    const parsed = transitionSchema.safeParse(body);

    if (!parsed.success) {
      const reasonIssue = parsed.error.issues.find(
        (issue) => issue.path[0] === "reason",
      );
      return NextResponse.json(
        {
          error: reasonIssue?.message ?? "Yêu cầu chuyển trạng thái không hợp lệ.",
          code: reasonIssue
            ? "cancellation_reason_required"
            : "invalid_transition_request",
        },
        { status: 400 },
      );
    }

    const result = await transitionStaffOrder(orderCode, {
      targetStatus: parsed.data.status,
      actorLabel: actor.email ?? actor.userId,
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (error) {
    return staffApiErrorResponse(error);
  }
}
