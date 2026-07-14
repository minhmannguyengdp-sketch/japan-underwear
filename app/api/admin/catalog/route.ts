import { NextResponse } from "next/server";

import { requireRole, STAFF_ROLES } from "@/lib/authz";
import { listManagedCatalog } from "@/lib/catalog-admin";
import { catalogAdminApiErrorResponse } from "@/lib/catalog-admin-http";
import type { CatalogAdminStatusFilter } from "@/lib/catalog-admin-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireRole(STAFF_ROLES);
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status");
    const status: CatalogAdminStatusFilter =
      statusValue === "active" || statusValue === "inactive" ? statusValue : "all";
    const limitValue = Number(url.searchParams.get("limit") ?? "100");
    const catalog = await listManagedCatalog({
      q: url.searchParams.get("q"),
      status,
      limit: limitValue,
    });
    return NextResponse.json({ catalog });
  } catch (error) {
    return catalogAdminApiErrorResponse(error);
  }
}
